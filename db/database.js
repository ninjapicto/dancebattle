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

  // Main rounds table — one row per round
  db.run(`
    CREATE TABLE IF NOT EXISTS rounds (
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
    )
  `)

  // Criterion scores table — one row per judge per criterion per round
  db.run(`
    CREATE TABLE IF NOT EXISTS criterion_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER,
      judge_name TEXT,
      criterion TEXT,
      red_score INTEGER,
      blue_score INTEGER,
      FOREIGN KEY (round_id) REFERENCES rounds(id)
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

async function saveRound({ eventName, roundNumber, redName, blueName, judgeCount, redTotal, blueTotal, winner, scores, criteria }) {
  const database = await getDb()

  // Insert the round summary
  database.run(
    `INSERT INTO rounds (event_name, round_number, red_name, blue_name, judge_count, red_total, blue_total, winner)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [eventName, roundNumber, redName, blueName, judgeCount || 3, redTotal, blueTotal, winner]
  )

  // Get the round id we just inserted
  const result = database.exec('SELECT last_insert_rowid() as id')
  const roundId = result[0].values[0][0]

  // Insert one row per judge per criterion
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
  const result = database.exec('SELECT * FROM rounds ORDER BY created_at DESC')
  if (!result.length) return []
  const { columns, values } = result[0]
  return values.map(row => {
    const obj = {}
    columns.forEach((col, i) => obj[col] = row[i])
    return obj
  })
}

async function getRoundDetail(roundId) {
  const database = await getDb()

  // Get round summary
  const roundResult = database.exec(`SELECT * FROM rounds WHERE id = ?`, [roundId])
  if (!roundResult.length) return null
  const roundCols = roundResult[0].columns
  const round = {}
  roundCols.forEach((col, i) => round[col] = roundResult[0].values[0][i])

  // Get criterion breakdown
  const scoresResult = database.exec(
    `SELECT judge_name, criterion, red_score, blue_score FROM criterion_scores WHERE round_id = ? ORDER BY judge_name, rowid`,
    [roundId]
  )

  round.criterionScores = []
  if (scoresResult.length) {
    const { columns, values } = scoresResult[0]
    round.criterionScores = values.map(row => {
      const obj = {}
      columns.forEach((col, i) => obj[col] = row[i])
      return obj
    })
  }

  return round
}

// Initialise on startup
getDb().catch(console.error)

module.exports = { saveRound, getRounds, getRoundDetail }
