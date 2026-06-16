const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const path = require('path')
const db = require('./db/database')

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(express.static(path.join(__dirname, 'public')))
app.use(express.json())

let state = {
  eventName:     'Dance Battle',
  roundNumber:   1,
  redName:       'Red Corner',
  blueName:      'Blue Corner',
  judgeCount:    3,
  judgePassword: '',
  status:        'waiting',
  scores:        {}
}

// Track connected judges: { socketId: judgeName }
let connectedJudges = {}

const CRITERIA = [
  'Musicality',
  'Technique',
  'Creativity',
  'Execution',
  'Performance'
]

function tallyScores() {
  let red = 0, blue = 0
  const judgeBreakdown = []
  for (const [judgeName, judgeScores] of Object.entries(state.scores)) {
    const jRed  = judgeScores.red.reduce((a, b) => a + b, 0)
    const jBlue = judgeScores.blue.reduce((a, b) => a + b, 0)
    red  += jRed
    blue += jBlue
    judgeBreakdown.push({ judgeName, red: jRed, blue: jBlue })
  }
  return { red, blue, winner: red > blue ? 'red' : blue > red ? 'blue' : 'tie', judgeBreakdown }
}

function judgeSlotsFull() {
  return Object.keys(connectedJudges).length >= state.judgeCount
}

function broadcastState() {
  const hasScores   = Object.keys(state.scores).length > 0
  const tally       = hasScores ? tallyScores() : null
  const judgesVoted = Object.keys(state.scores).length
  const judgeNames  = Object.keys(state.scores)
  const connectedCount = Object.keys(connectedJudges).length

  io.to('mc').emit('stateUpdate', {
    ...state,
    tally,
    judgesVoted,
    judgeNames,
    connectedJudges: Object.values(connectedJudges),
    connectedCount,
    criteria: CRITERIA
  })

  io.to('display').emit('stateUpdate', {
    status:       state.status,
    redName:      state.redName,
    blueName:     state.blueName,
    roundNumber:  state.roundNumber,
    judgeCount:   state.judgeCount,
    judgeNames,
    judgesVoted,
    tally: state.status === 'revealed' ? tally : null
  })

  io.to('judges').emit('stateUpdate', {
    status:      state.status,
    redName:     state.redName,
    blueName:    state.blueName,
    roundNumber: state.roundNumber,
    criteria:    CRITERIA,
    hasPassword: !!state.judgePassword
  })
}

io.on('connection', (socket) => {

  socket.on('probe', () => {
    socket.emit('probeResponse', {
      hasPassword: !!state.judgePassword,
      slotsFull:   judgeSlotsFull(),
      slotsLeft:   Math.max(0, state.judgeCount - Object.keys(connectedJudges).length)
    })
  })

  socket.on('joinAs', ({ role, password, judgeName } = {}) => {
    if (role === 'judge') {
      // Check if slots are full
      if (judgeSlotsFull()) {
        socket.emit('authError', 'All Judge Slots Are Full for This Event.')
        return
      }
      // Check password
      if (state.judgePassword && password !== state.judgePassword) {
        socket.emit('authError', 'Incorrect Password — Please Try Again.')
        return
      }
      // Check name not already taken
      const takenNames = Object.values(connectedJudges).map(n => n.toLowerCase())
      if (takenNames.includes(judgeName.trim().toLowerCase())) {
        socket.emit('authError', 'That Name Is Already in Use — Please Use a Different Name.')
        return
      }

      socket.join('judges')
      socket.role = 'judge'
      socket.judgeName = judgeName.trim()
      connectedJudges[socket.id] = socket.judgeName

      socket.emit('authOk')
      socket.emit('stateUpdate', {
        status:      state.status,
        redName:     state.redName,
        blueName:    state.blueName,
        roundNumber: state.roundNumber,
        criteria:    CRITERIA,
        hasPassword: !!state.judgePassword
      })
      broadcastState()
      return
    }

    if (role === 'mc') {
      socket.join('mc')
      socket.role = 'mc'
    } else if (role === 'display') {
      socket.join('display')
      socket.role = 'display'
    }
    broadcastState()
  })

  socket.on('configureRound', ({ redName, blueName, eventName, judgeCount, judgePassword }) => {
    if (socket.role !== 'mc') return
    if (redName !== undefined)       state.redName       = redName
    if (blueName !== undefined)      state.blueName      = blueName
    if (eventName !== undefined)     state.eventName     = eventName
    if (judgePassword !== undefined) state.judgePassword = judgePassword
    if (judgeCount && Number.isInteger(judgeCount) && judgeCount >= 1 && judgeCount <= 10) {
      state.judgeCount = judgeCount
    }
    broadcastState()
  })

  socket.on('openVoting', () => {
    if (socket.role !== 'mc') return
    const connected = Object.keys(connectedJudges).length
    if (connected < state.judgeCount) {
      socket.emit('mcError', `Cannot Open Voting — Only ${connected} of ${state.judgeCount} Judges Are Connected.`)
      return
    }
    state.scores = {}
    state.status = 'open'
    broadcastState()
  })

  socket.on('lockVoting', () => {
    if (socket.role !== 'mc') return
    state.status = 'locked'
    broadcastState()
  })

  socket.on('reopenVoting', () => {
    if (socket.role !== 'mc') return
    state.status = 'open'
    broadcastState()
  })

  socket.on('revealResult', async () => {
    if (socket.role !== 'mc') return
    const submitted = Object.keys(state.scores).length
    if (submitted === 0) {
      socket.emit('mcError', 'No Scores Have Been Submitted Yet.')
      return
    }
    if (submitted < state.judgeCount) {
      socket.emit('mcError', `Cannot Reveal — Only ${submitted} of ${state.judgeCount} Judges Have Submitted Scores.`)
      return
    }
    state.status = 'revealed'
    const tally = tallyScores()
    try {
      await db.saveRound({
        eventName:   state.eventName,
        roundNumber: state.roundNumber,
        redName:     state.redName,
        blueName:    state.blueName,
        judgeCount:  state.judgeCount,
        redTotal:    tally.red,
        blueTotal:   tally.blue,
        winner:      tally.winner,
        scores:      state.scores,
        criteria:    CRITERIA
      })
    } catch (err) {
      console.error('Error saving round:', err)
    }
    broadcastState()
  })

  socket.on('nextRound', () => {
    if (socket.role !== 'mc') return
    state.roundNumber += 1
    state.scores = {}
    state.status = 'waiting'
    broadcastState()
  })

  socket.on('submitScores', ({ judgeId, red, blue }) => {
    if (state.status !== 'open') return
    if (!judgeId || !Array.isArray(red) || !Array.isArray(blue)) return
    if (red.length !== CRITERIA.length || blue.length !== CRITERIA.length) return
    state.scores[judgeId] = { red, blue }
    const judgesVoted = Object.keys(state.scores).length
    io.to('mc').emit('judgeVoted', { judgeId, judgesVoted, total: state.judgeCount })
    broadcastState()
  })

  socket.on('disconnect', () => {
    if (socket.role === 'judge' && connectedJudges[socket.id]) {
      console.log('Judge disconnected:', connectedJudges[socket.id])
      delete connectedJudges[socket.id]
      broadcastState()
    }
  })
})

app.get('/api/rounds', async (req, res) => {
  res.json(await db.getRounds())
})

app.get('/api/rounds/:id', async (req, res) => {
  const round = await db.getRoundDetail(parseInt(req.params.id))
  if (!round) return res.status(404).json({ error: 'Not Found' })
  res.json(round)
})

app.get('/api/scorecards', async (req, res) => {
  res.json(await db.getScorecards())
})

app.post('/api/clear', async (req, res) => {
  await db.clearAll()
  state.roundNumber = 1
  state.scores = {}
  state.status = 'waiting'
  connectedJudges = {}
  broadcastState()
  res.json({ ok: true })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`  MC:         http://localhost:${PORT}/mc.html`)
  console.log(`  Judge:      http://localhost:${PORT}/judge.html`)
  console.log(`  Display:    http://localhost:${PORT}/display.html`)
  console.log(`  Scorecards: http://localhost:${PORT}/scorecards.html`)
})
