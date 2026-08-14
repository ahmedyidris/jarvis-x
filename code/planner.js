const lib = require('./lib.js');

const planMultiStep = async (goal) => {
  console.log(`Planning: ${goal}`);
  const steps = [
    { step: 1, action: 'Analyze goal scope', tier: 'quick' },
    { step: 2, action: 'Identify constraints', tier: 'hard' },
    { step: 3, action: 'Design solution', tier: 'consequential' },
    { step: 4, action: 'Validate safety', tier: 'consequential' }
  ];
  return { goal, steps, success: true };
};

module.exports = { planMultiStep };

if (require.main === module) {
  const goal = process.argv.slice(2).join(' ') || 'Default goal';
  planMultiStep(goal).then(result => {
    console.log(JSON.stringify(result, null, 2));
  });
}
