const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '../logs/actions.jsonl');

const logAction = (actionType, description, approvedBy, outcome, evidence = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    action_type: actionType,
    description,
    approved_by: approvedBy,
    outcome,
    evidence
  };
  
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(LOG_FILE, line);
};

const readAuditLog = () => {
  if (!fs.existsSync(LOG_FILE)) return [];
  const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n');
  return lines.map(l => JSON.parse(l));
};

const auditSummary = () => {
  const log = readAuditLog();
  const grouped = {};
  log.forEach(entry => {
    grouped[entry.action_type] = (grouped[entry.action_type] || 0) + 1;
  });
  return grouped;
};

module.exports = { logAction, readAuditLog, auditSummary };

if (require.main === module) {
  console.log('Audit Summary:');
  console.log(auditSummary());
  console.log('\nLast 3 actions:');
  readAuditLog().slice(-3).forEach(a => {
    console.log(`  [${a.timestamp}] ${a.action_type}: ${a.description} (${a.outcome})`);
  });
}
