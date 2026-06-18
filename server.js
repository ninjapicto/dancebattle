const express    = require('express')
const http       = require('http')
const { Server } = require('socket.io')
const path       = require('path')
const db         = require('./db/database')

const app    = express()
const server = http.createServer(app)
const io     = new Server(server)

app.use(express.static(path.join(__dirname, 'public')))
app.use(express.json())

// ── State ─────────────────────────────────────────────────────────────────────

let state = {
  eventName:         'Dance Battle',
  roundNumber:        1,
  roundsInBattle:      2,       // total rounds expected in current battle
  showRoundWinners:    true,    // if false, display skips round-level reveal
  redName:            'Red Corner',
  blueName:           'Blue Corner',
  judgeCount:          3,
  judgePassword:       '',
  status:             'waiting', // waiting | open | locked | revealed | battle_over
  scores:              {},        // current round: { judgeName: { red: [], blue: [] } }
  battleRoundTotals:   []         // [{ red, blue }] one entry per completed round this battle
}

// Connected judges: { socketId: judgeName }
let connectedJudges = {}

const CRITERIA = [
  'Musicality',
  'Technique',
  'Creativity',
  'Execution',
  'Performance'
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function connectedCount() { return Object.keys(connectedJudges).length }
function connectedNames() { return Object.values(connectedJudges) }
function slotsFull()      { return connectedCount() >= state.judgeCount }
function slotsLeft()      { return Math.max(0, state.judgeCount - connectedCount()) }

function tallyScores() {
  let red = 0, blue = 0
  const judgeBreakdown = []
  for (const [name, s] of Object.entries(state.scores)) {
    const r = s.red.reduce((a, b) => a + b, 0)
    const b = s.blue.reduce((a, b) => a + b, 0)
    red += r; blue += b
    judgeBreakdown.push({ judgeName: name, red: r, blue: b })
  }
  return {
    red, blue,
    winner: red > blue ? 'red' : blue > red ? 'blue' : 'tie',
    judgeBreakdown
  }
}

function tallyBattle() {
  let red = 0, blue = 0
  for (const r of state.battleRoundTotals) { red += r.red; blue += r.blue }
  return { red, blue, winner: red > blue ? 'red' : blue > red ? 'blue' : 'tie' }
}

function broadcastState() {
  const voted       = Object.keys(state.scores)
  const hasScores   = voted.length > 0
  const tally       = hasScores ? tallyScores() : null
  const battleTally = state.battleRoundTotals.length > 0 ? tallyBattle() : null

  io.to('mc').emit('stateUpdate', {
    ...state,
    tally,
    battleTally,
    judgesVoted:     voted.length,
    judgeNames:      voted,
    connectedJudges: connectedNames(),
    connectedCount:  connectedCount(),
    criteria:        CRITERIA
  })

  io.to('display').emit('stateUpdate', {
    status:           state.status,
    eventName:        state.eventName,
    redName:          state.redName,
    blueName:         state.blueName,
    roundNumber:      state.roundNumber,
    roundsInBattle:   state.roundsInBattle,
    showRoundWinners: state.showRoundWinners,
    judgeCount:       state.judgeCount,
    judgeNames:       voted,
    judgesVoted:      voted.length,
    tally:            state.status === 'revealed'    ? tally       : null,
    battleTally:      state.status === 'battle_over' ? battleTally : null
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

function sendJudgeState(socket) {
  socket.emit('stateUpdate', {
    status:      state.status,
    redName:     state.redName,
    blueName:    state.blueName,
    roundNumber: state.roundNumber,
    criteria:    CRITERIA,
    hasPassword: !!state.judgePassword
  })
}

// ── Sockets ───────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {

  socket.on('probe', () => {
    socket.emit('probeResponse', {
      hasPassword: !!state.judgePassword,
      slotsFull:   slotsFull(),
      slotsLeft:   slotsLeft()
    })
  })

  socket.on('joinAs', ({ role, password, judgeName } = {}) => {
    if (role === 'judge') {
      if (slotsFull()) {
        socket.emit('authError', 'All Judge Slots Are Full for This Event.')
        return
      }
      if (state.judgePassword && password !== state.judgePassword) {
        socket.emit('authError', 'Incorrect Password — Please Try Again.')
        return
      }
      const taken = connectedNames().map(n => n.toLowerCase())
      if (taken.includes(judgeName.trim().toLowerCase())) {
        socket.emit('authError', 'That Name Is Already in Use — Please Use a Different Name.')
        return
      }
      socket.join('judges')
      socket.role      = 'judge'
      socket.judgeName = judgeName.trim()
      connectedJudges[socket.id] = socket.judgeName
      socket.emit('authOk')
      sendJudgeState(socket)
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

  socket.on('configureRound', ({ eventName, redName, blueName, judgeCount, judgePassword, showRoundWinners }) => {
    if (socket.role !== 'mc') return
    if (eventName        !== undefined) state.eventName        = eventName
    if (redName          !== undefined) state.redName          = redName
    if (blueName         !== undefined) state.blueName         = blueName
    if (judgePassword    !== undefined) state.judgePassword    = judgePassword
    if (showRoundWinners !== undefined) state.showRoundWinners = showRoundWinners
    if (judgeCount && Number.isInteger(judgeCount) && judgeCount >= 1 && judgeCount <= 10)
      state.judgeCount = judgeCount
    broadcastState()
  })

  socket.on('openVoting', () => {
    if (socket.role !== 'mc') return
    if (connectedCount() < state.judgeCount) {
      socket.emit('mcError', `Cannot Open Voting — Only ${connectedCount()} of ${state.judgeCount} Judges Are Connected.`)
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
    const tally  = tallyScores()
    state.battleRoundTotals.push({ red: tally.red, blue: tally.blue })

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
    state.scores       = {}
    state.status       = 'waiting'
    broadcastState()
  })

  socket.on('revealBattleWinner', () => {
    if (socket.role !== 'mc') return
    if (state.battleRoundTotals.length === 0) {
      socket.emit('mcError', 'No Completed Rounds to Tally for This Battle.')
      return
    }
    state.status = 'battle_over'
    broadcastState()
  })

  socket.on('newBattle', ({ redName, blueName, roundsInBattle }) => {
    if (socket.role !== 'mc') return
    state.roundNumber       = 1
    state.scores            = {}
    state.status            = 'waiting'
    state.battleRoundTotals = []
    if (redName)  state.redName  = redName
    if (blueName) state.blueName = blueName
    if (roundsInBattle && Number.isInteger(roundsInBattle) && roundsInBattle >= 1 && roundsInBattle <= 10)
      state.roundsInBattle = roundsInBattle
    broadcastState()
  })

  socket.on('submitScores', ({ judgeId, red, blue }) => {
    if (state.status !== 'open') return
    if (!judgeId || !Array.isArray(red) || !Array.isArray(blue)) return
    if (red.length !== CRITERIA.length || blue.length !== CRITERIA.length) return
    state.scores[judgeId] = { red, blue }
    io.to('mc').emit('judgeVoted', { judgeId, judgesVoted: Object.keys(state.scores).length })
    broadcastState()
  })

  socket.on('disconnect', () => {
    if (connectedJudges[socket.id]) {
      delete connectedJudges[socket.id]
      broadcastState()
    }
  })
})

// ── REST ──────────────────────────────────────────────────────────────────────

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
  state.roundNumber       = 1
  state.scores            = {}
  state.status            = 'waiting'
  state.battleRoundTotals = []
  connectedJudges         = {}
  broadcastState()
  res.json({ ok: true })
})

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`  MC:         http://localhost:${PORT}/mc.html`)
  console.log(`  Judge:      http://localhost:${PORT}/judge.html`)
  console.log(`  Display:    http://localhost:${PORT}/display.html`)
  console.log(`  Scorecards: http://localhost:${PORT}/scorecards.html`)
})
