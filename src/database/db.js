const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const config = require('../config');

const dbPath = path.resolve(
  process.cwd(),
  config.databasePath || 'database/database.sqlite'
);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

let sqlite;
let database;

const ready = initSqlJs().then(SQL => {
  sqlite = SQL;

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    database = new SQL.Database(buffer);
  } else {
    database = new SQL.Database();
  }

  console.log('✅ SQL.js database loaded');
});

function save() {
  if (!database) return;
  const data = database.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function exec(sql) {
  database.run(sql);
  save();
}

function prepare(sql) {
  return {
    get(...params) {
      const stmt = database.prepare(sql);
      stmt.bind(params);

      let result;

      if (stmt.step()) {
        result = stmt.getAsObject();
      }

      stmt.free();
      return result;
    },

    all(...params) {
      const stmt = database.prepare(sql);
      stmt.bind(params);

      const rows = [];

      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }

      stmt.free();
      return rows;
    },

    run(...params) {
      database.run(sql, params);
      save();

      return {
        changes: database.getRowsModified()
      };
    }
  };
}

module.exports = {
  exec,
  prepare,
  ready
};
