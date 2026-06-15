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
  eventName: 'Dance Battle',
  roundNumber: 1,
  redName: 'Red Corner',
  blueName: 'Blue Corner',
  judgeCount: 3,
  status: 'waiting',
  scores: {}
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
  for (const judge of Object.values(state.scores)) {
    red  += judge.red.reduce((a, b) => a + b, 0)
    blue += judge.blue.reduce((a, b) => a + b, 0)
  }
  const winner = red > blue ? 'red' : blue > red ? 'blue' : 'tie'
  return { red, blue, winner }
}

function broadcastState() {
  const tally = Object.keys(state.scores).length > 0 ? tallyScores() : null
  const judgesVoted = Object.keys(state.scores).length

  io.to('mc').emit('stateUpdate', { ...state, tally, judgesVoted, criteria: CRITERIA })
  io.to('display').emit('stateUpdate', {
    status: state.status,
    redName: state.redName,
    blueName: state.blueName,
    roundNumber: state.roundNumber,
    eventName: state.eventName,
    judgeCount: state.judgeCount,
    tally: state.status === 'revealed' ? tally : null,
    judgesVoted
  })
  io.to('judges').emit('stateUpdate', {
    status: state.status,
    redName: state.redName,
    blueName: state.blueName,
    roundNumber: state.roundNumber,
    criteria: CRITERIA
  })
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id)

  socket.on('joinAs', (role) => {
    socket.join(role === 'mc' ? 'mc' : role === 'display' ? 'display' : 'judges')
    socket.role = role
    broadcastState()
  })

  socket.on('configureRound', ({ redName, blueName, eventName, judgeCount }) => {
    if (socket.role !== 'mc') return
    state.redName   = redName   || state.redName
    state.blueName  = blueName  || state.blueName
    state.eventName = eventName || state.eventName
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
    state.status = 'revealed'
    const tally = tallyScores()
    await db.saveRound({
      eventName: state.eventName,
      roundNumber: state.roundNumber,
      redName: state.redName,
      blueName: state.blueName,
      judgeCount: state.judgeCount,
      redTotal: tally.red,
      blueTotal: tally.blue,
      winner: tally.winner,
      scores: state.scores,
      criteria: CRITERIA
    })
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
    console.log('Client disconnected:', socket.id)
  })
})

app.get('/api/rounds', async (req, res) => {
  const rounds = await db.getRounds()
  res.json(rounds)
})

app.get('/api/rounds/:id', async (req, res) => {
  const round = await db.getRoundDetail(parseInt(req.params.id))
  if (!round) return res.status(404).json({ error: 'Round not found' })
  res.json(round)
})

app.post('/api/reset', (req, res) => {
  state = {
    eventName: req.body.eventName || 'Dance Battle',
    roundNumber: 1,
    redName: 'Red Corner',
    blueName: 'Blue Corner',
    judgeCount: req.body.judgeCount || 3,
    status: 'waiting',
    scores: {}
  }
  broadcastState()
  res.json({ ok: true })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`Dance Battle server running on http://localhost:${PORT}`)
  console.log(`  Judge view:   http://localhost:${PORT}/judge.html`)
  console.log(`  MC panel:     http://localhost:${PORT}/mc.html`)
  console.log(`  Display:      http://localhost:${PORT}/display.html`)
})
