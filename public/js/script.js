// 全局变量
let editor = null;
let currentFile = null;
let modifiedFiles = new Map();
let currentLanguage = 'en';

// 文件修改状态管理
const fileModificationManager = {
  // 存储文件的原始内容
  originalContents: new Map(),
  
  // 设置文件的原始内容
  setOriginalContent(filePath, content) {
    this.originalContents.set(filePath, content);
  },
  
  // 获取文件的原始内容
  getOriginalContent(filePath) {
    return this.originalContents.get(filePath);
  },
  
  // 检查文件是否被修改
  isFileModified(filePath, currentContent) {
    const originalContent = this.getOriginalContent(filePath);
    return originalContent !== currentContent;
  },
  
  // 更新文件的修改状态
  updateModificationStatus(filePath, currentContent) {
    const isModified = this.isFileModified(filePath, currentContent);
    
    if (isModified) {
      modifiedFiles.set(filePath, true);
    } else {
      modifiedFiles.delete(filePath);
    }
    
    updateFileModifiedStatus(filePath, isModified);
    return isModified;
  },
  
  // 重置文件的修改状态
  resetModificationStatus(filePath) {
    modifiedFiles.delete(filePath);
    this.originalContents.delete(filePath);
    updateFileModifiedStatus(filePath, false);
  },
  
  // 暂存文件
  stageChanges(file) {
    console.log('暂存文件:', file);
  },
  
  // 取消暂存文件
  unstageChanges(file) {
    console.log('取消暂存文件:', file);
  },
  
  // 丢弃文件
  discardChanges(file) {
    console.log('丢弃文件:', file);
  }
};

// 更新文件树中的修改状态标识
function updateFileModifiedStatus(filePath, isModified) {
  console.log('Updating file status:', filePath, isModified); // 添加日志
  const normalizedPath = filePath.replace(/\\/g, '/');
  
  // 查找所有可能匹配的元素
  const fileElements = document.querySelectorAll('.file-tree-item');
  let found = false;
  
  fileElements.forEach(element => {
    // 检查所有可能存储路径的属性
    const itemPath = element.getAttribute('data-path') || 
                    element.querySelector('[data-path]')?.getAttribute('data-path');
                    
    if (itemPath === normalizedPath) {
      found = true;
      const content = element.querySelector('.file-tree-item-content');
      if (content) {
        console.log('Found element, updating class:', isModified); // 添加日志
        if (isModified) {
          content.classList.add('modified');
        } else {
          content.classList.remove('modified');
        }
      }
    }
  });
  
  if (!found) {
    console.log('Element not found for path:', normalizedPath); // 添加日志
  }
}

// 初始化编辑器的修改监听
function initializeEditorChangeListener() {
  if (!editor || !currentFile) return;
  
  // 移除旧的监听器
  if (editor._contentChangeListener) {
    editor._contentChangeListener.dispose();
  }
  
  // 添加新的监听器
  editor._contentChangeListener = editor.onDidChangeModelContent(() => {
    console.log('Content changed'); // 添加日志
    const newContent = editor.getValue();
    const originalContent = fileModificationManager.getOriginalContent(currentFile);
    const isModified = newContent !== originalContent;
    
    console.log('Content comparison:', { // 添加日志
      isModified,
      currentLength: newContent.length,
      originalLength: originalContent.length
    });
    
    fileModificationManager.updateModificationStatus(currentFile, newContent);
  });
}

// 加载文件内容
async function loadFileContent(path) {
  try {
    const response = await fetch(`/file-content?path=${encodeURIComponent(path)}`);
    if (!response.ok) {
      throw new Error("Failed to load file content");
    }

    const data = await response.json();
    const extension = path.split(".").pop().toLowerCase();
    const language = getMonacoLanguage(extension);
    const normalizedPath = path.replace(/\\/g, '/');

    if (editor) {
      // 如果是同一个文件，不重新加载
      if (currentFile === normalizedPath) {
        return;
      }
      
      // 设置新内容
      editor.setValue(data.content || "");
      currentFile = normalizedPath;
      monaco.editor.setModelLanguage(editor.getModel(), language);
      
      // 保存原始内容并重置修改状态
      fileModificationManager.setOriginalContent(normalizedPath, data.content || "");
      fileModificationManager.resetModificationStatus(normalizedPath);
      
      // 初始化变更监听
      initializeEditorChangeListener();
    }
  } catch (error) {
    console.error("Failed to load file:", error);
    showToast("Failed to load file content", "error");
  }
}

// 保存文件内容
async function saveFile() {
  if (!currentFile || !editor) return;

  try {
    const content = editor.getValue();
    const response = await fetch('/save-file', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: currentFile,
        content: content,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to save file");
    }

    // 更新原始内容
    fileModificationManager.setOriginalContent(currentFile, content);
    fileModificationManager.resetModificationStatus(currentFile);
    
    showToast("File saved successfully", "success");
  } catch (error) {
    console.error("Failed to save file:", error);
    showToast("Failed to save file", "error");
  }
}

// 处理文件点击事件
async function handleFileClick(path, type) {
  if (type === "directory") {
    toggleFolder(path);
    return;
  }

  // 如果当前文件已修改，提示保存
  if (currentFile && modifiedFiles.has(currentFile)) {
    const confirmed = await showConfirmDialog(
      "Save changes",
      "Do you want to save the changes to the current file?"
    );
    if (confirmed) {
      await saveFile();
    }
  }

  if (type === "file") {
    try {
      // 确保编辑器已初始化
      if (!editor) {
        await initializeMonacoEditor();
      }

      // 获取文件内容
      await loadFileContent(path);
      
      // 关闭文件浏览器模态框
      document.getElementById("fileBrowserModal").classList.remove("show");
    } catch (error) {
      console.error("Error opening file:", error);
      showToast("Failed to open file", "error");
    }
  }
}

// Monaco Editor配置
require.config({
  paths: {
    vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.36.1/min/vs",
  },
});

// 确保加载所有需要的语言支持
require(["vs/editor/editor.main"], function () {
  // 注册scss语言支持
  monaco.languages.register({ id: 'scss' });
  
  // 配置scss语言的语法高亮规则
  monaco.languages.setMonarchTokensProvider('scss', {
    defaultToken: '',
    tokenPostfix: '.scss',

    brackets: [
      { open: '{', close: '}', token: 'delimiter.curly' },
      { open: '[', close: ']', token: 'delimiter.bracket' },
      { open: '(', close: ')', token: 'delimiter.parenthesis' },
    ],

    keywords: [
      'import', 'extend', 'mixin', 'include', 'if', 'else', 'for', 'each', 'while',
      'return', 'function', 'at-root', 'debug', 'warn', 'error'
    ],

    operators: ['+', '-', '*', '/', '%', '=', '>', '<', '>=', '<=', '==', '!=', '&'],

    tokenizer: {
      root: [
        { include: '@selector' },
        { include: '@whitespace' },
        { include: '@numbers' },
        { include: '@strings' },
        { include: '@variables' },
      ],

      whitespace: [
        [/\s+/, 'white'],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment'],
      ],

      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],

      selector: [
        [/[a-zA-Z_][\w-]*/, {
          cases: {
            '@keywords': 'keyword',
            '@default': 'identifier'
          }
        }],
        [/&/, 'tag'],
        [/[.,#]@[-\w]+/, 'tag'],
        [/\[[^\]]+\]/, 'tag'],
      ],

      numbers: [
        [/-?\d*\.\d+([eE][-+]?\d+)?[px%em]*/, 'number'],
        [/-?\d+[px%em]*/, 'number'],
      ],

      strings: [
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/'([^'\\]|\\.)*$/, 'string.invalid'],
        [/"/, 'string', '@string_double'],
        [/'/, 'string', '@string_single'],
      ],

      string_double: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],

      string_single: [
        [/[^\\']+/, 'string'],
        [/\\./, 'string.escape'],
        [/'/, 'string', '@pop'],
      ],

      variables: [
        [/\$\w+/, 'variable'],
      ],
    },
  });
});

async function initializeSidebar() {
  try {
    const response = await fetch("/api/languages");
    const languages = await response.json();
    console.log("Available languages:", languages);

    const sidebarLinks = document.getElementById("sidebar-links");
    sidebarLinks.innerHTML = ``;

    if (languages && languages.length > 0) {
      languages.forEach((lang) => {
        const li = createSidebarLink(lang);
        sidebarLinks.appendChild(li);
      });

      // Load first language's files automatically
      showFiles(languages[0]);
    } else {
      console.error("No languages available.");
      document.getElementById("content").innerHTML = `
                <div class="error">
                    <i class="fas fa-exclamation-circle"></i> No projects available.
                </div>
            `;
    }
  } catch (error) {
    console.error("Failed to initialize sidebar:", error);
    document.getElementById("content").innerHTML = `
            <div class="error">
                <i class="fas fa-exclamation-circle"></i> Failed to load projects: ${error.message}
            </div>
        `;
  }
}

function createSidebarLink(language) {
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.href = "#";
  a.textContent = language;
  a.onclick = (e) => {
    e.preventDefault();
    showFiles(language);
  };
  li.appendChild(a);
  return li;
}

async function fetchFiles(language) {
  const contentDiv = document.getElementById("content");
  contentDiv.innerHTML = `
        <div class="loading">
            <i class="fas fa-circle-notch fa-lg"></i>
            <span>Loading ${language} files...</span>
        </div>
    `;

  try {
    const response = await fetch(`/api/files/${language}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to fetch files");
    }

    const { staged, working } = data;

    contentDiv.innerHTML = `
            <div class="project">
                <div class="project-header">
                    <div class="project-info">
                        <h1 class="project-title">
                            <i class="fas fa-code-branch"></i>
                            Git Status Panel
                        </h1>
                    </div>
                    <div class="project-actions">
                        <button class="btn btn-icon btn-primary" onclick="openCommitModal('${language}')">
                            <i class="fas fa-check"></i>
                            <span class="tooltip">Commit Changes</span>
                        </button>
                        <button class="btn btn-icon btn-secondary" onclick="openFileBrowser('${language}')">
                            <i class="fas fa-folder-open"></i>
                            <span class="tooltip">Browse Files</span>
                        </button>
                        <button class="btn btn-icon btn-secondary" onclick="openInVSCode('${language}')">
                            <i class="fas fa-external-link-alt"></i>
                            <span class="tooltip">Open in VSCode</span>
                        </button>
                    </div>
                </div>
                <div class="file-sections">
                    <div class="file-section staged-files">
                        <div class="section-title">
                            <i class="fas fa-check-circle"></i>
                            Staged Files
                        </div>
                        ${renderFileList(staged, "staged", language)}
                    </div>
                    <div class="file-section working-files">
                        <div class="section-title">
                            <i class="fas fa-edit"></i>
                            Working Files
                        </div>
                        ${renderFileList(working, "working", language)}
                    </div>
                </div>
            </div>
        `;
  } catch (error) {
    console.error(`Failed to fetch files for ${language}:`, error);
    showError(error.message);
  }
}

function renderFileList(files, type, language) {
  let html = `<ul class="file-list">`;
  if (files.length > 0) {
    files.forEach((file) => {
      html += `
                <li class="file-item">
                    <div class="file-name">
                        <i class="fas fa-file-alt"></i>
                        ${file}
                    </div>
                    <div class="file-actions">
                        ${
                          type === "staged"
                            ? `
                            <button class="btn btn-danger" onclick="handleGitAction('unstage', '${language}', '${file}')">
                                <i class="fas fa-minus-circle"></i>
                                Unstage
                            </button>
                        `
                            : `
                            <button class="btn btn-success" onclick="handleGitAction('stage', '${language}', '${file}')">
                                <i class="fas fa-plus-circle"></i>
                                Stage
                            </button>
                            <button class="btn btn-danger" onclick="handleGitAction('discard', '${language}', '${file}')">
                                <i class="fas fa-trash-alt"></i>
                                Discard
                            </button>
                        `
                        }
                    </div>
                </li>
            `;
    });
  } else {
    html += `
            <li class="empty-list">
                <i class="fas fa-info-circle"></i>
                No ${type} files
            </li>
        `;
  }
  html += "</ul>";
  return html;
}

async function openInVSCode(language) {
  try {
    const response = await fetch(`/api/open-vscode/${language}`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error("Failed to open VS Code");
    }
    showToast("Opening in VS Code...", "success");
  } catch (error) {
    console.error("Error:", error);
    showToast("Failed to open VS Code", "error");
  }
}

async function handleGitAction(action, language, file) {
  try {
    const response = await fetch(`/api/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ language, file }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Failed to ${action} file`);
    }

    showToast(`File ${action}d successfully`, 'success');
    
    // 更新文件状态
    switch (action) {
      case 'stage':
        fileModificationManager.stageChanges(file);
        break;
      case 'unstage':
        fileModificationManager.unstageChanges(file);
        break;
      case 'discard':
        fileModificationManager.discardChanges(file);
        break;
    }

    // 刷新文件列表
    await fetchFiles(language);
  } catch (error) {
    console.error(`${action} error:`, error);
    showToast(error.message, 'error');
  }
}

async function openCommitModal(language) {
  try {
    const response = await fetch(`/api/check-status/${language}`);
    const data = await response.json();

    const stagedFiles = data.staged || [];

    if (stagedFiles.length === 0) {
      showToast(
        "No changes staged for commit. Please stage some changes first.",
        "error"
      );
      return;
    }

    document.getElementById("commitModal").classList.add("show");
    document.getElementById("commitMessage").value = "";
    document.getElementById("commitMessage").dataset.language = language;
    document.getElementById("commitMessage").focus();
  } catch (error) {
    console.error("Error checking repository status:", error);
    showToast("Failed to check repository status", "error");
  }
}

function closeCommitModal() {
  document.getElementById("commitModal").classList.remove("show");
}

async function submitCommit() {
  const messageInput = document.getElementById("commitMessage");
  const message = messageInput.value.trim();
  const language = messageInput.dataset.language;

  if (!message) {
    showToast("Please enter a commit message", "error");
    return;
  }

  try {
    const response = await fetch(`/api/commit/${language}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      throw new Error("Failed to commit changes");
    }

    showToast("Changes committed successfully", "success");
    closeCommitModal();
    fetchFiles(language);
  } catch (error) {
    console.error("Error:", error);
    showToast("Failed to commit changes", "error");
  }
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML =
    type === "success" ? `<i class="fas fa-check"></i>${message}` : message;

  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function showError(message) {
  const contentDiv = document.getElementById("content");
  contentDiv.innerHTML = `
        <div class="error">
            <i class="fas fa-exclamation-circle"></i>
            ${message}
        </div>
    `;
}

function showFiles(language) {
  fetchFiles(language);

  // Update active state in sidebar
  const sidebarLinks = document.querySelectorAll(".sidebar-links a");
  sidebarLinks.forEach((link) => {
    if (link.textContent.trim() === language) {
      link.classList.add("active");
    } else {
      link.classList.remove("active");
    }
  });
}

// 获取Monaco Editor的语言标识符
function getMonacoLanguage(extension) {
  const languageMap = {
    js: "javascript",
    ts: "typescript",
    html: "html",
    css: "css",
    scss: "scss",
    sass: "scss",
    json: "json",
    md: "markdown",
    py: "python",
    java: "java",
    cpp: "cpp",
    c: "c",
    cs: "csharp",
    go: "go",
    rs: "rust",
    php: "php",
    rb: "ruby",
    sql: "sql",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    sh: "shell",
    bash: "shell",
    txt: "plaintext",
    tpl: "html"  // tpl文件使用html语法高亮
  };

  // 获取文件扩展名的小写形式
  const ext = extension.toLowerCase();
  
  // 返回映射的语言，如果没有映射则返回plaintext
  return languageMap[ext] || "plaintext";
}

// 更新当前语言的函数
async function updateCurrentLanguage(language) {
  if (!language) return;
  
  // 更新当前语言
  currentLanguage = language;
  console.log('当前语言已更新为:', language);
  
  // 更新标签激活状态
  const tabs = document.querySelectorAll('.language-tab');
  tabs.forEach(tab => {
    if (tab.getAttribute('data-language') === language) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
  
  // 更新项目根路径
  await updateProjectRoot(language);
  
  // 更新文件树
  await loadFileTree();
}

// 更新项目根路径
async function updateProjectRoot(language) {
  if (!language) return null;
  try {
    const response = await fetch(`/project-root?language=${encodeURIComponent(language)}`, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error('获取项目根路径失败');
    }
    
    const data = await response.json();
    console.log('项目根路径已更新:', { 语言: language, 路径: data.path });
    return data.path;
  } catch (error) {
    console.error('更新项目根路径失败:', error);
    showToast('更新项目根路径失败', 'error');
    return null;
  }
}

// 初始化语言选择器和事件监听
function initializeLanguageHandling() {
  // 监听语言标签点击
  const languageTabs = document.querySelectorAll('.language-tab');
  languageTabs.forEach(tab => {
    tab.addEventListener('click', async (e) => {
      e.preventDefault();
      const language = e.target.getAttribute('data-language');
      if (language && language !== currentLanguage) {
        await updateCurrentLanguage(language);
      }
    });
  });

  // 设置初始语言
  const activeTab = document.querySelector('.language-tab.active');
  if (activeTab) {
    const initialLanguage = activeTab.getAttribute('data-language');
    updateCurrentLanguage(initialLanguage);
  }
}

let projectRoot = ``;

async function loadFileTree() {
  try {
    const languageSelect = document.querySelector('#sidebar-links a.active');
    const language = languageSelect ? languageSelect.textContent.trim() : 'en';
    const rootResponse = await fetch(`/project-root?language=${encodeURIComponent(language)}`);
    if (!rootResponse.ok) throw new Error("Failed to fetch project root");
    const rootData = await rootResponse.json();
    projectRoot = rootData.path;

    const response = await fetch("/files");
    if (!response.ok) throw new Error("Failed to fetch files");

    const items = await response.json();
    await renderFileTree(items);
  } catch (error) {
    console.error("Failed to load file tree:", error);
    showToast("Failed to load project files", "error");
  }
}

async function renderFileTree(items) {
  const folders = [
    { name: "Dev", path: `templates/new-template/Dev`, type: "directory" },
    { name: "lan", path: `templates/new-template/lan`, type: "directory" },
    { name: "tpl", path: `templates/new-template/tpl`, type: "directory" },
  ];

  function buildTreeHTML() {
    let html = '<ul class="file-tree-list">';
    for (const item of folders) {
      html += `
                <li class="file-tree-item">
                    <div class="file-tree-item-content">
                        <i class="fas fa-chevron-right folder-icon"></i>
                        <i class="fas fa-folder"></i>
                        <span class="file-name" data-path="${item.path}" data-type="${item.type}" title="${item.name}">${item.name}</span>
                    </div>
                    <ul class="file-tree-list" style="display: none;"></ul>
                </li>
            `;
    }
    return html + "</ul>";
  }

  async function renderSubTree(parentElement, path) {
    try {
      const response = await fetch(`/files?path=${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error("Failed to fetch files");

      const files = await response.json();
      const subList = parentElement.querySelector(".file-tree-list");

      if (files && files.length > 0) {
        let html = "";
        for (const file of files) {
          const isDirectory = file.type === "directory";
          html += `
                        <li class="file-tree-item">
                            <div class="file-tree-item-content">
                                ${
                                  isDirectory
                                    ? '<i class="fas fa-chevron-right folder-icon"></i>'
                                    : ""
                                }
                                <i class="fas ${
                                  isDirectory ? "fa-folder" : "fa-file-alt"
                                }"></i>
                                <span class="file-name" data-path="${
                                  file.path
                                }" data-type="${file.type}" title="${file.name}">${file.name}</span>
                            </div>
                            ${
                              isDirectory
                                ? '<ul class="file-tree-list" style="display: none;"></ul>'
                                : ""
                            }
                        </li>
                    `;
        }
        subList.innerHTML = html;

        const newFolderContents = subList.querySelectorAll(
          ".file-tree-item-content"
        );
        newFolderContents.forEach((content) => {
          content.addEventListener("click", handleFolderClick);
        });
      }
    } catch (error) {
      console.error("Error loading files:", error);
      showToast("Failed to load files", "error");
    }
  }

  function handleFolderClick(e) {
    e.stopPropagation();
    const listItem = e.currentTarget.closest(".file-tree-item");
    const icon = listItem.querySelector(".folder-icon");
    const subList = listItem.querySelector(".file-tree-list");
    const fileName = listItem.querySelector(".file-name");
    const path = fileName.dataset.path;
    const type = fileName.dataset.type;

    if (type === "directory") {
      if (subList) {
        icon.classList.toggle("fa-chevron-down");
        icon.classList.toggle("fa-chevron-right");

        if (subList.children.length === 0) {
          renderSubTree(listItem, path);
        }

        subList.style.display =
          subList.style.display === "none" ? "block" : "none";
      }
    }

    handleFileClick(e, path, type);
  }

  const fileTreeContent = document.getElementById("fileTree");
  if (fileTreeContent) {
    const treeHtml = buildTreeHTML();
    fileTreeContent.innerHTML = treeHtml;

    const folderContents = fileTreeContent.querySelectorAll(
      ".file-tree-item-content"
    );
    folderContents.forEach((content) => {
      content.addEventListener("click", handleFolderClick);
    });
  }
}

async function handleFileClick(event, path, type) {
  event.stopPropagation();

  // 移除所有项的激活状态
  const treeItems = document.querySelectorAll(".file-tree-item-content");
  treeItems.forEach((item) => {
    item.classList.remove("active");
  });

  // 添加激活状态到当前项
  event.currentTarget.classList.add("active");

  if (type === "file") {
    try {
      // 确保编辑器已初始化
      if (!editor) {
        await initializeMonacoEditor();
      }

      // 获取文件内容
      await loadFileContent(path);
    } catch (error) {
      console.error("Failed to load file:", error);
      showToast("Failed to load file content", "error");
    }
  }
}

async function initializeMonacoEditor() {
  if (!editor) {
    const editorContainer = document.getElementById("monacoEditor");
    if (!editorContainer) return;

    editor = monaco.editor.create(editorContainer, {
      theme: "vs-dark",
      automaticLayout: true,
      fontSize: 16,
      fontFamily: "'JetBrains Mono', monospace",
      lineHeight: 30,
      minimap: { enabled: true },
    });

    // 监听编辑器内容变化
    editor.onDidChangeModelContent(() => {
      if (currentFile) {
        modifiedFiles.set(currentFile, true);
        updateFileModifiedStatus(currentFile, true);
      }
    });

    // Ctrl+S保存命令
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      if (currentFile) {
        try {
          const content = editor.getValue();
          const languageSelect = document.querySelector('#sidebar-links a.active');
          const selectedLanguage = languageSelect ? languageSelect.textContent.trim() : 'en';
          
          const response = await fetch('http://localhost:3005/save-file', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              path: currentFile,
              content: content,
              language: selectedLanguage
            })
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || '保存文件失败');
          }

          const result = await response.json();
          console.log('文件已保存到:', result.path);
          
          // 清除修改状态
          modifiedFiles.delete(currentFile);
          updateFileModifiedStatus(currentFile, false);
          
          showToast('文件保存成功', 'success');
        } catch (error) {
          console.error('保存文件时出错:', error);
          showToast('保存文件失败: ' + error.message, 'error');
        }
      } else {
        showToast('没有打开的文件', 'error');
      }
    });
  }
  return editor;
}

async function openFileBrowser(language) {
  currentLanguage = language;
  document.getElementById("fileBrowserModal").classList.add("show");
  await loadFileTree();
}

function closeFileBrowser() {
  document.getElementById("fileBrowserModal").classList.remove("show");
}

async function openFile(path) {
  try {
    if (!editor) {
      await initializeMonacoEditor();
    }

    // 获取当前选择的语言
    const languageSelect = document.querySelector('.language-select');
    if (languageSelect) {
      updateCurrentLanguage(languageSelect.value);
    }

    await loadFileContent(path);
  } catch (error) {
    console.error("Failed to load file:", error);
    showToast("Failed to load file content", "error");
  }
}

async function getProjectRoot() {
  try {
    const languageSelect = document.querySelector('#sidebar-links a.active');
    const language = languageSelect ? languageSelect.textContent.trim() : 'en';
    
    const response = await fetch(`/project-root?language=${encodeURIComponent(language)}`);
    if (!response.ok) {
      throw new Error('获取项目根路径失败');
    }
    
    const data = await response.json();
    console.log('获取到项目根路径:', { 语言: language, 路径: data.path });
    return data.path;
  } catch (error) {
    console.error('获取项目根路径出错:', error);
    showToast('获取项目根路径失败', 'error');
    return null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initializeLanguageHandling();
  initializeSidebar();
});
