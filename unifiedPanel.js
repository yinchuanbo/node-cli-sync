const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Load the config file
const config = require('./config');

// Function to get staged files for a given directory
function getStagedFiles(dir) {
  return new Promise((resolve, reject) => {
    exec('git diff --name-only --cached', { cwd: dir }, (error, stdout, stderr) => {
      if (error) {
        reject(`Error: ${stderr}`);
      } else {
        const files = stdout.split('\n').filter(file => file);
        resolve(files);
      }
    });
  });
}

// Main function to aggregate staged files from all projects
async function showUnifiedPanel() {
  const projects = config.vidnoz.lans;
  const allStagedFiles = {};

  for (const [lang, projectPath] of Object.entries(projects)) {
    try {
      const stagedFiles = await getStagedFiles(projectPath);
      allStagedFiles[lang] = stagedFiles;
    } catch (error) {
      console.error(`Failed to get staged files for ${lang}: ${error}`);
    }
  }

  console.log('Unified Staged Files Panel:');
  for (const [lang, files] of Object.entries(allStagedFiles)) {
    console.log(`\nLanguage: ${lang}`);
    if (files.length > 0) {
      files.forEach(file => console.log(`  - ${file}`));
    } else {
      console.log('  No staged files');
    }
  }
}

// Run the main function
showUnifiedPanel();
