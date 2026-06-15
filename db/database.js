const path = require('path')
const fs = require('fs')
const initSqlJs = require('sql.js')

const DB_PATH = path.join(__dirname, 'event.db')
let db = null

async function getDb() {
  if (db) return db
  const SQL = await initSqlJs()

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH))
  } else {
    db = new SQL.Database()
  }

  db.run(`CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name TEXT,
    round_number INTEGER,
    red_name TEXT,
    blue_name TEXT,
    judge_count INTEGER,
    red_total INTEGER,
    blue_total INTEGER,
    winner TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS criterion_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER,
    judge_name TEXT,
    criterion TEXT,
    red_score INTEGER,
    blue_score INTEGER,
    FOREIGN KEY (round_id) REFERENCES rounds(id)
  )`)

  persist()
  return db
}

function persist() {
  if (!db) return
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()))
}

function toObjects(result) {
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const obj = {}
    columns.forEach((col, i) => obj[col] = row[i])
    return obj
  })
}

async function saveRound({ eventName, roundNumber, redName, blueName, judgeCount, redTotal, blueTotal, winner, scores, criteria }) {
  const database = await getDb()
  database.run(
    `INSERT INTO rounds (event_name, round_number, red_name, blue_name, judge_count, red_total, blue_total, winner)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [eventName, roundNumber, redName, blueName, judgeCount || 3, redTotal, blueTotal, winner]
  )
  const roundId = toObjects(database.exec('SELECT last_insert_rowid() as id'))[0].id
  for (const [judgeName, judgeScores] of Object.entries(scores)) {
    criteria.forEach((criterion, i) => {
      database.run(
        `INSERT INTO criterion_scores (round_id, judge_name, criterion, red_score, blue_score)
         VALUES (?, ?, ?, ?, ?)`,
        [roundId, judgeName, criterion, judgeScores.red[i], judgeScores.blue[i]]
      )
    })
  }
  persist()
}

async function getRounds() {
  const database = await getDb()
  return toObjects(database.exec('SELECT * FROM rounds ORDER BY created_at DESC'))
}

async function getRoundDetail(roundId) {
  const database = await getDb()
  const rounds = toObjects(database.exec(`SELECT * FROM rounds WHERE id = ?`, [roundId]))
  if (!rounds.length) return null
  const round = rounds[0]
  round.criterionScores = toObjects(
    database.exec(`SELECT judge_name, criterion, red_score, blue_score FROM criterion_scores WHERE round_id = ? ORDER BY judge_name, rowid`, [roundId])
  )
  return round
}

async function getScorecards() {
  const database = await getDb()
  // All criterion scores joined with round info
  const rows = toObjects(database.exec(`
    SELECT cs.judge_name, cs.criterion, cs.red_score, cs.blue_score,
           r.round_number, r.red_name, r.blue_name, r.event_name, r.winner, r.id as round_id
    FROM criterion_scores cs
    JOIN rounds r ON r.id = cs.round_id
    ORDER BY cs.judge_name, r.round_number, cs.rowid
  `))
  return rows
}

getDb().catch(console.error)

async function clearAll() {
  const database = await getDb()
  database.run('DELETE FROM criterion_scores')
  database.run('DELETE FROM rounds')
  database.run('DELETE FROM sqlite_sequence WHERE name="rounds" OR name="criterion_scores"')
  persist()
}

module.exports = { saveRound, getRounds, getRoundDetail, getScorecards, clearAll }
