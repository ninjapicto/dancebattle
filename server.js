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
  eventName:   'Dance Battle',
  roundNumber: 1,
  redName:     'Red Corner',
  blueName:    'Blue Corner',
  judgeCount:  3,
  judgePassword: '',      // blank = no password required
  status:      'waiting', // waiting | open | locked | revealed
  scores:      {}
}

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
    const judgeRed  = judgeScores.red.reduce((a, b) => a + b, 0)
    const judgeBlue = judgeScores.blue.reduce((a, b) => a + b, 0)
    red  += judgeRed
    blue += judgeBlue
    judgeBreakdown.push({ judgeName, red: judgeRed, blue: judgeBlue })
  }
  const winner = red > blue ? 'red' : blue > red ? 'blue' : 'tie'
  return { red, blue, winner, judgeBreakdown }
}

function broadcastState() {
  const hasScores  = Object.keys(state.scores).length > 0
  const tally      = hasScores ? tallyScores() : null
  const judgesVoted = Object.keys(state.scores).length
  const judgeNames  = Object.keys(state.scores)

  io.to('mc').emit('stateUpdate', { ...state, tally, judgesVoted, judgeNames, criteria: CRITERIA })
  io.to('display').emit('stateUpdate', {
    status:       state.status,
    redName:      state.redName,
    blueName:     state.blueName,
    roundNumber:  state.roundNumber,
    eventName:    state.eventName,
    judgeCount:   state.judgeCount,
    judgeNames,
    tally:        state.status === 'revealed' ? tally : null,
    judgesVoted
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
  console.log('Client Connected:', socket.id)

  socket.on('joinAs', ({ role, password, judgeName } = {}) => {
    if (role === 'probe') {
      // Just send state so judge login page can show/hide password field
      socket.emit('stateUpdate', { hasPassword: !!state.judgePassword, status: state.status })
      return
    }
    if (role === 'judge') {
      if (state.judgePassword && password !== state.judgePassword) {
        socket.emit('authError', 'Incorrect Password — Please Try Again.')
        return
      }
      socket.join('judges')
      socket.role = 'judge'
      socket.judgeName = judgeName
    } else if (role === 'mc') {
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
    state.redName       = redName       || state.redName
    state.blueName      = blueName      || state.blueName
    state.eventName     = eventName     || state.eventName
    state.judgePassword = judgePassword !== undefined ? judgePassword : state.judgePassword
    if (judgeCount && Number.isInteger(judgeCount) && judgeCount >= 1 && judgeCount <= 10) {
      state.judgeCount = judgeCount
    }
    broadcastState()
  })

  socket.on('openVoting', () => {
    if (socket.role !== 'mc') return
    state.status = 'open'
    state.scores = {}
    broadcastState()
  })

  socket.on('lockVoting', () => {
    if (socket.role !== 'mc') return
    state.status = 'locked'
    broadcastState()
  })

  socket.on('revealResult', async () => {
    if (socket.role !== 'mc') return
    if (Object.keys(state.scores).length === 0) {
      socket.emit('revealError', 'No Scores Have Been Submitted Yet.')
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
    console.log('Client Disconnected:', socket.id)
  })
})

app.get('/api/rounds', async (req, res) => {
  const rounds = await db.getRounds()
  res.json(rounds)
})

app.get('/api/rounds/:id', async (req, res) => {
  const round = await db.getRoundDetail(parseInt(req.params.id))
  if (!round) return res.status(404).json({ error: 'Round Not Found' })
  res.json(round)
})

app.get('/api/scorecards', async (req, res) => {
  const data = await db.getScorecards()
  res.json(data)
})

// Clear all event data
app.post('/api/clear', async (req, res) => {
  await db.clearAll()
  state = {
    eventName:     state.eventName,
    roundNumber:   1,
    redName:       'Red Corner',
    blueName:      'Blue Corner',
    judgeCount:    state.judgeCount,
    judgePassword: state.judgePassword,
    status:        'waiting',
    scores:        {}
  }
  broadcastState()
  res.json({ ok: true })
})

app.post('/api/reset', (req, res) => {
  state = {
    eventName:     req.body.eventName || 'Dance Battle',
    roundNumber:   1,
    redName:       'Red Corner',
    blueName:      'Blue Corner',
    judgeCount:    req.body.judgeCount || 3,
    judgePassword: '',
    status:        'waiting',
    scores:        {}
  }
  broadcastState()
  res.json({ ok: true })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`Dance Battle server running on http://localhost:${PORT}`)
  console.log(`  Judge view:    http://localhost:${PORT}/judge.html`)
  console.log(`  MC panel:      http://localhost:${PORT}/mc.html`)
  console.log(`  Display:       http://localhost:${PORT}/display.html`)
  console.log(`  Scorecards:    http://localhost:${PORT}/scorecards.html`)
})
