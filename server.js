const express = require('express');
const { exec } = require('child_process');
const config = require('./config');

const app = express();

// Add middleware to parse JSON bodies
app.use(express.json());

let port = 3001;

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

// Function to get working directory files
function getWorkingFiles(dir) {
  return new Promise((resolve, reject) => {
    exec('git ls-files --modified --others --exclude-standard', { cwd: dir }, (error, stdout, stderr) => {
      if (error) {
        reject(`Error: ${stderr}`);
      } else {
        const files = stdout.split('\n').filter(file => file);
        resolve(files);
      }
    });
  });
}

// API endpoint to fetch staged files
app.get('/api/staged-files', async (req, res) => {
  const projects = config.vidnoz.lans;
  const allStagedFiles = {};

  for (const [lang, projectPath] of Object.entries(projects)) {
    try {
      const stagedFiles = await getStagedFiles(projectPath);
      allStagedFiles[lang] = stagedFiles;
    } catch (error) {
      allStagedFiles[lang] = `Failed to get staged files: ${error}`;
    }
  }

  res.json(allStagedFiles);
});

// API endpoint to fetch both staged and working files
app.get('/api/files', async (req, res) => {
  const projects = config.vidnoz.lans;
  const allFiles = {};

  for (const [lang, projectPath] of Object.entries(projects)) {
    try {
      const [stagedFiles, workingFiles] = await Promise.all([
        getStagedFiles(projectPath),
        getWorkingFiles(projectPath)
      ]);
      allFiles[lang] = {
        staged: stagedFiles,
        working: workingFiles
      };
    } catch (error) {
      allFiles[lang] = {
        staged: [],
        working: [],
        error: `Failed to get files: ${error}`
      };
    }
  }

  res.json(allFiles);
});

// API endpoint to get available languages
app.get('/api/languages', (req, res) => {
  const languages = Object.keys(config.vidnoz.lans);
  res.json(languages);
});

// API endpoint to fetch both staged and working files for a specific language
app.get('/api/files/:language', async (req, res) => {
  const language = req.params.language;
  const projectPath = config.vidnoz.lans[language];

  if (!projectPath) {
    return res.status(404).json({ error: `Language ${language} not found` });
  }

  try {
    const [stagedFiles, workingFiles] = await Promise.all([
      getStagedFiles(projectPath),
      getWorkingFiles(projectPath)
    ]);

    res.json({
      staged: stagedFiles,
      working: workingFiles
    });
  } catch (error) {
    res.status(500).json({
      staged: [],
      working: [],
      error: `Failed to get files: ${error}`
    });
  }
});

// API endpoint to unstage a file
app.post('/api/unstage', async (req, res) => {
  const { language, file } = req.body;
  const projectPath = config.vidnoz.lans[language];

  if (!projectPath) {
    return res.status(404).json({ error: `Language ${language} not found` });
  }

  try {
    await new Promise((resolve, reject) => {
      exec('git reset HEAD ' + file, { cwd: projectPath }, (error, stdout, stderr) => {
        if (error) {
          reject(`Error: ${stderr}`);
        } else {
          resolve(stdout);
        }
      });
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: `Failed to unstage file: ${error}` });
  }
});

// API endpoint to stage a file
app.post('/api/stage', async (req, res) => {
  const { language, file } = req.body;
  const projectPath = config.vidnoz.lans[language];

  if (!projectPath) {
    return res.status(404).json({ error: `Language ${language} not found` });
  }

  try {
    await new Promise((resolve, reject) => {
      exec('git add ' + file, { cwd: projectPath }, (error, stdout, stderr) => {
        if (error) {
          reject(`Error: ${stderr}`);
        } else {
          resolve(stdout);
        }
      });
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: `Failed to stage file: ${error}` });
  }
});

// API endpoint to discard changes in working directory
app.post('/api/discard', async (req, res) => {
  const { language, file } = req.body;
  const projectPath = config.vidnoz.lans[language];

  if (!projectPath) {
    return res.status(404).json({ error: `Language ${language} not found` });
  }

  try {
    await new Promise((resolve, reject) => {
      exec('git checkout -- ' + file, { cwd: projectPath }, (error, stdout, stderr) => {
        if (error) {
          reject(`Error: ${stderr}`);
        } else {
          resolve(stdout);
        }
      });
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: `Failed to discard changes: ${error}` });
  }
});

// API endpoint to open VS Code with the project directory
app.post('/api/open-vscode/:language', (req, res) => {
  const language = req.params.language;
  const projectPath = config.vidnoz.lans[language];

  if (!projectPath) {
    return res.status(404).json({ error: 'Project path not found' });
  }

  exec(`code "${projectPath}"`, (error) => {
    if (error) {
      console.error('Error opening VS Code:', error);
      return res.status(500).json({ error: 'Failed to open VS Code' });
    }
    res.json({ success: true });
  });
});

// Serve the frontend
app.use(express.static('public'));

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(port);
