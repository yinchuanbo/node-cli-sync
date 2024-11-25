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

// 检查工作区和暂存区状态
app.get('/api/check-status/:language', (req, res) => {
  const language = req.params.language;
  const projectPath = config.vidnoz.lans[language];

  if (!projectPath) {
    return res.status(404).json({ error: 'Project path not found' });
  }

  exec('git status --porcelain', { cwd: projectPath }, (error, stdout) => {
    if (error) {
      return res.status(500).json({ error: 'Failed to check git status' });
    }

    const lines = stdout.split('\n').filter(line => line.trim());
    console.log('Git status output for', language, ':', lines);

    // 工作区文件包括：
    // ?? - 未跟踪的文件
    // M  - 已修改未暂存的文件
    // D  - 已删除未暂存的文件
    // AM - 新添加但又被修改的文件
    const hasWorkingChanges = lines.some(line => {
      const status = line.trim().substring(0, 2);
      return status === '??' || // 未跟踪文件
             status[1] === 'M' || // 修改未暂存
             status[1] === 'D' || // 删除未暂存
             (status[0] === 'A' && status[1] === 'M'); // 新添加但又被修改
    });

    // 暂存区文件包括：
    // M  - 修改并已暂存
    // A  - 新添加到暂存区
    // D  - 删除并已暂存
    // R  - 重命名并已暂存
    const hasStagedChanges = lines.some(line => {
      const status = line.trim().substring(0, 2);
      return (status[0] === 'M' && status[1] !== 'M') || // 修改已暂存（且工作区无新修改）
             (status[0] === 'A' && status[1] !== 'M') || // 新增已暂存（且工作区无新修改）
             (status[0] === 'D' && status[1] !== 'M') || // 删除已暂存（且工作区无新修改）
             (status[0] === 'R' && status[1] !== 'M');   // 重命名已暂存（且工作区无新修改）
    });

    console.log('Status check result for', language, ':', {
      hasWorkingChanges,
      hasStagedChanges,
      files: lines.map(line => ({
        status: line.substring(0, 2),
        file: line.substring(3),
        isWorking: line.startsWith('??') || line[1] === 'M' || line[1] === 'D',
        isStaged: line[0] === 'M' || line[0] === 'A' || line[0] === 'D' || line[0] === 'R'
      }))
    });

    res.json({ 
      hasWorkingChanges,
      hasStagedChanges,
      debug: {
        raw: lines,
        parsed: lines.map(line => ({
          status: line.substring(0, 2),
          file: line.substring(3)
        }))
      }
    });
  });
});

// 提交暂存的更改
app.post('/api/commit/:language', (req, res) => {
  const language = req.params.language;
  const { message } = req.body;
  const projectPath = config.vidnoz.lans[language];

  if (!projectPath) {
    return res.status(404).json({ error: 'Project path not found' });
  }

  if (!message) {
    return res.status(400).json({ error: 'Commit message is required' });
  }

  exec(`git commit -m "${message}"`, { cwd: projectPath }, (error, stdout) => {
    if (error) {
      return res.status(500).json({ error: 'Failed to commit changes' });
    }
    res.json({ success: true, message: stdout });
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
