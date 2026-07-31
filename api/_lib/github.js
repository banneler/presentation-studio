const GITHUB_API = 'https://api.github.com';

function getRepo() {
  return process.env.GITHUB_REPO || 'banneler/presentation-studio';
}

function getToken() {
  return (process.env.GITHUB_TOKEN || '').trim();
}

function requireGitHub() {
  const token = getToken();
  if (!token) {
    const error = new Error('GITHUB_TOKEN is not configured');
    error.statusCode = 500;
    throw error;
  }
  return token;
}

async function githubRequest(path, options = {}) {
  const token = requireGitHub();
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'presentation-studio',
      ...(options.headers || {})
    }
  });

  if (response.status === 404) return null;

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = { message: text };
  }

  if (!response.ok) {
    const error = new Error(data?.message || `GitHub API error (${response.status})`);
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

async function getFile(path) {
  const repo = getRepo();
  return githubRequest(`/repos/${repo}/contents/${encodeURI(path)}?ref=main`);
}

async function putFile({ path, content, message, sha }) {
  const repo = getRepo();
  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: 'main'
  };
  if (sha) body.sha = sha;

  return githubRequest(`/repos/${repo}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function upsertFile({ path, content, message }) {
  const existing = await getFile(path);
  return putFile({
    path,
    content,
    message,
    sha: existing?.sha
  });
}

async function listDirectory(path) {
  const repo = getRepo();
  const data = await githubRequest(`/repos/${repo}/contents/${encodeURI(path)}?ref=main`);
  return Array.isArray(data) ? data : [];
}

async function listFilesRecursive(path) {
  const entries = await listDirectory(path);
  const files = [];
  for (const entry of entries) {
    if (entry.type === 'file') {
      files.push({ path: entry.path, sha: entry.sha });
    } else if (entry.type === 'dir') {
      files.push(...await listFilesRecursive(entry.path));
    }
  }
  return files;
}

async function deleteFile({ path, sha, message }) {
  const repo = getRepo();
  return githubRequest(`/repos/${repo}/contents/${encodeURI(path)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      sha,
      branch: 'main'
    })
  });
}

async function deleteDirectory({ path, message }) {
  const files = await listFilesRecursive(path);
  for (const file of files) {
    await deleteFile({
      path: file.path,
      sha: file.sha,
      message: `${message}: ${file.path}`
    });
  }
  return { deleted: files.length, files: files.map(file => file.path) };
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

module.exports = {
  getRepo,
  getToken,
  requireGitHub,
  getFile,
  upsertFile,
  listDirectory,
  listFilesRecursive,
  deleteFile,
  deleteDirectory,
  slugify
};
