const express = require('express');
const { exec } = require('child_process');
const config = require('./config');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();

// Add middleware
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Set correct port
const port = 3005;

// 项目根路径配置
let PROJECT_ROOT = '';

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

// Project files API
app.get('/api/project-files/:language', (req, res) => {
  const language = req.params.language;
  const projectPath = config.vidnoz.lans[language];
  
  try {
    const files = getProjectFiles(projectPath);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// File content API
app.get('/api/file-content/:language/*', (req, res) => {
  const language = req.params.language;
  const filePath = req.params[0];
  const projectPath = config.vidnoz.lans[language];
  const fullPath = path.join(projectPath, filePath);

  // Ensure the requested file is within the project directory
  if (!fullPath.startsWith(projectPath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const content = fs.readFileSync(fullPath, 'utf8');
      res.json({ content });
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function getProjectFiles(dir) {
  const items = fs.readdirSync(dir);
  const result = [];

  for (const item of items) {
    if (item === 'node_modules' || item === '.git') continue;

    const fullPath = path.join(dir, item);
    const relativePath = path.relative(dir, fullPath);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      result.push({
        name: item,
        path: relativePath,
        type: 'directory',
        children: getProjectFiles(fullPath)
      });
    } else {
      result.push({
        name: item,
        path: relativePath,
        type: 'file'
      });
    }
  }

  return result;
}

// 获取项目目录结构
app.get('/api/project-files/:language', (req, res) => {
  const language = req.params.language;
  const projectPath = config.vidnoz.lans[language];

  if (!projectPath) {
    return res.status(404).json({ error: 'Project path not found' });
  }

  function getDirectoryStructure(dir) {
    const items = fs.readdirSync(dir);
    return items.map(item => {
      const fullPath = path.join(dir, item);
      const relativePath = path.relative(projectPath, fullPath).replace(/\\/g, '/');
      
      const stats = fs.statSync(fullPath);
      
      if (stats.isDirectory()) {
        return {
          name: item,
          path: relativePath,
          type: 'directory',
          children: getDirectoryStructure(fullPath)
        };
      }
      
      return {
        name: item,
        path: relativePath,
        type: 'file',
        size: stats.size
      };
    });
  }

  try {
    const structure = getDirectoryStructure(projectPath);
    res.json(structure);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get project structure' });
  }
});

// 获取文件内容
app.get('/api/file-content/:language/*', (req, res) => {
  const language = req.params.language;
  const filePath = req.params[0];
  const projectPath = config.vidnoz.lans[language];

  if (!projectPath) {
    return res.status(404).json({ error: 'Project path not found' });
  }

  const fullPath = path.join(projectPath, filePath);

  // 安全检查：确保文件路径在项目目录内
  if (!fullPath.startsWith(projectPath)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// 获取文件内容的API
app.get('/file-content', async (req, res) => {
  try {
    const requestPath = req.query.path || '';
    // 确保路径安全，防止目录遍历攻击
    const normalizedPath = path.normalize(requestPath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(PROJECT_ROOT, normalizedPath);
    
    const content = await fs.promises.readFile(fullPath, 'utf-8');
    res.json({ content });
  } catch (error) {
    console.error('Error reading file:', error);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// 文件保存接口
app.post('/save-file', async (req, res) => {
  try {
    const { path: filePath, content, language } = req.body;
    if (!filePath || content === undefined || !language) {
      return res.status(400).json({ error: '需要提供文件路径、内容和语言' });
    }

    // 从配置中获取对应语言的项目根路径
    const projectRoot = config.vidnoz.lans[language];
    if (!projectRoot) {
      return res.status(400).json({ error: `不支持的语言: ${language}` });
    }

    // 构建完整的文件保存路径
    const fullPath = path.join(projectRoot, filePath);
    const dirPath = path.dirname(fullPath);

    console.log('保存文件信息:', {
      语言: language,
      项目根目录: projectRoot,
      文件路径: filePath,
      完整路径: fullPath
    });

    // 确保目录存在
    await fs.promises.mkdir(dirPath, { recursive: true });

    // 写入文件
    await fs.promises.writeFile(fullPath, content, 'utf8');
    console.log('文件已保存到:', fullPath);
    res.json({ success: true, path: fullPath });
  } catch (error) {
    console.error('保存文件时出错:', error);
    res.status(500).json({ error: '保存文件失败: ' + error.message });
  }
});

// 获取项目根路径API
app.get('/project-root', (req, res) => {
  const language = req.query.language || 'en';
  const projectRoot = config.vidnoz.lans[language];
  
  if (!projectRoot) {
    return res.status(400).json({ error: `不支持的语言: ${language}` });
  }
  PROJECT_ROOT = projectRoot;

  console.log('返回项目根路径:', { 语言: language, 路径: projectRoot });
  res.json({ path: projectRoot });
});

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

// 获取文件列表的函数
async function getFiles(dirPath) {
  try {
    const files = await fs.promises.readdir(dirPath);
    const fileList = [];

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stats = await fs.promises.stat(fullPath);
      const relativePath = path.relative(PROJECT_ROOT, fullPath).replace(/\\/g, '/');
      
      fileList.push({
        name: file,
        path: relativePath,
        type: stats.isDirectory() ? 'directory' : 'file'
      });
    }

    return fileList;
  } catch (error) {
    console.error('Error reading directory:', error);
    return [];
  }
}

// 文件树API
app.get('/files', async (req, res) => {
  try {
    const requestPath = req.query.path || '';
    // 确保路径安全，防止目录遍历攻击
    const normalizedPath = path.normalize(requestPath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(PROJECT_ROOT, normalizedPath);
    
    const files = await getFiles(fullPath);
    console.log("PROJECT_ROOT", PROJECT_ROOT, normalizedPath)
    res.json(files);
  } catch (error) {
    console.error('Error getting files:', error);
    res.status(500).json({ error: 'Failed to get files' });
  }
});
