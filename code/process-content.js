#!/usr/bin/env node
/**
 * CONTENT PIPELINE PROCESSOR
 * 
 * Scheduled task that:
 * 1. Finds jobs in CUT_APPROVED state and distributes them.
 * 2. Finds jobs in SCRIPT_APPROVED state and renders them.
 */
const { openPipeline, STATES } = require('./content-pipeline.js');
const renderer = require('./content-render.js');
const distributor = require('./content-distribute.js');

async function main() {
  console.log("Checking content pipeline for pending production jobs...");
  const pipeline = openPipeline();
  const allJobs = pipeline.list();
  
  for (const job of allJobs) {
    if (job.state === STATES.SCRIPT_APPROVED) {
       console.log(`Job ${job.job_id} is script-approved. Rendering...`);
       try {
           const renderResult = await renderer.render(job);
           console.log(`Render complete for ${job.job_id}:`, renderResult);
           // In reality, we'd advance the state, but `content-pipeline` uses checkGate.
           pipeline.advance(job.job_id, STATES.CUT_READY, renderResult);
       } catch (e) {
           console.error(`Render failed for ${job.job_id}:`, e.message);
       }
    } else if (job.state === STATES.CUT_APPROVED) {
       console.log(`Job ${job.job_id} is cut-approved. Distributing...`);
       try {
           const distResult = await distributor.post(job);
           console.log(`Distribution complete for ${job.job_id}:`, distResult);
           // Pipeline expects post() from pipeline to update to POSTED, but we do it manually if needed
           // or use pipeline.post()
       } catch (e) {
           console.error(`Distribution failed for ${job.job_id}:`, e.message);
       }
    }
  }
}

if (require.main === module) {
  main().catch(console.error);
}
