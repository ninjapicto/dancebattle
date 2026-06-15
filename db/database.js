const path = require('path')
const fs = require('fs')
const initSqlJs = require('sql.js')

const DB_PATH = path.join(__dirname, 'event.db')

let db = null

async function getDb() {
  if (db) return db
  const SQL = await initSqlJs()

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT,
      round_number INTEGER,
      red_name TEXT,
      blue_name TEXT,
      judge_count INTEGER,
      red_score INTEGER,
      blue_score INTEGER,
      winner TEXT,
      scores_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  persist()
  return db
}

function persist() {
  if (!db) return
  const data = db.export()
  fs.writeFileSync(DB_PATH, Buffer.from(data))
}

async function saveRound({ eventName, roundNumber, redName, blueName, judgeCount, redScore, blueScore, winner, scores }) {
  const database = await getDb()
  database.run(
    `INSERT INTO rounds (event_name, round_number, red_name, blue_name, judge_count, red_score, blue_score, winner, scores_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [eventName, roundNumber, redName, blueName, judgeCount || 3, redScore, blueScore, winner, scores]
  )
  persist()
}

async function getRounds() {
  const database = await getDb()
  const result = database.exec('SELECT * FROM rounds ORDER BY created_at DESC')
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const obj = {}
    columns.forEach((col, i) => obj[col] = row[i])
    return obj
  })
}

// Initialise on startup
getDb().catch(console.error)

module.exports = { saveRound, getRounds }
