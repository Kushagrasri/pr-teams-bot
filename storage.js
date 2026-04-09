const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state.json');

const state = {
  reviewers: {},
  activePRs: {}
};

function load() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      Object.assign(state.reviewers, data.reviewers || {});
      Object.assign(state.activePRs, data.activePRs || {});
      console.log(
        `[storage] Loaded ${Object.keys(state.reviewers).length} reviewers, ${Object.keys(state.activePRs).length} active PRs`
      );
    }
  } catch (e) {
    console.warn('[storage] Could not load state:', e.message);
  }
}

function save() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn('[storage] Could not save state:', e.message);
  }
}

load();

module.exports = { state, save };
