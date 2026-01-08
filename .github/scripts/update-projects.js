#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ORG_NAME = 'BBBaden-Moodle-userscripts';

// Load external repositories from config file
let EXTERNAL_REPOS = [];
try {
  const configPath = path.join(__dirname, '../external-repos.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    EXTERNAL_REPOS = config.repositories || [];
  }
} catch (error) {
  console.warn('Could not load external-repos.json, using default list');
  EXTERNAL_REPOS = [
    { owner: 'BBBelektronik', repo: 'moodle-scrollpos' },
    { owner: 'MyDrift-user', repo: 'Moodle-Header-Addons' },
    { owner: 'MyDrift-user', repo: 'CompactFrontpage' },
    { owner: 'MyDrift-user', repo: 'MidnightMoodle' },
    { owner: 'Hutch79', repo: 'CompactMoodle' }
  ];
}

// Function to make GitHub API requests
function githubRequest(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'BBBaden-Moodle-Update-Bot',
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${GITHUB_TOKEN}`
      }
    };

    https.get(url, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`GitHub API request failed with status ${res.statusCode}: ${data}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Function to fetch all repositories from the organization
async function fetchOrgRepos() {
  const repos = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = `https://api.github.com/orgs/${ORG_NAME}/repos?page=${page}&per_page=100`;
    const data = await githubRequest(url);

    if (data.length === 0) {
      hasMore = false;
    } else {
      repos.push(...data);
      page++;
    }
  }

  return repos;
}

// Function to get repository default branch
async function getDefaultBranch(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  try {
    const data = await githubRequest(url);
    return data.default_branch || 'main';
  } catch (error) {
    return 'main';
  }
}

// Function to fetch repository contents to find userscripts
async function fetchRepoContents(owner, repo, path = '', branch = null) {
  if (!branch) {
    branch = await getDefaultBranch(owner, repo);
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  try {
    const result = await githubRequest(url);
    return Array.isArray(result) ? result : [];
  } catch (error) {
    // Only log 404s for root directory, not for optional icon directories
    if (!path || path === '') {
      console.error(`Error fetching contents for ${owner}/${repo}: ${error.message}`);
    }
    return [];
  }
}

// Function to search for userscript/userstyle files and icons in a repository
async function analyzeRepository(owner, repo, branch) {
  const contents = await fetchRepoContents(owner, repo, '', branch);
  const userscripts = [];
  const userstyles = [];
  let icon = null;

  const iconPatterns = ['icon.svg', 'icon.png', 'icon.jpg'];
  const iconDirs = [];

  for (const item of contents) {
    if (item.type === 'file') {
      // Check for userscripts/userstyles (exclude libraries)
      if (item.name.endsWith('.user.js') && !item.name.endsWith('.lib.user.js')) {
        userscripts.push(item);
      } else if (item.name.endsWith('.user.css')) {
        userstyles.push(item);
      }

      // Check for icon in root
      if (!icon && iconPatterns.includes(item.name.toLowerCase())) {
        icon = `https://github.com/${owner}/${repo}/raw/${branch}/${item.name}`;
      }
    } else if (item.type === 'dir') {
      // Track directories that might contain icons
      const dirName = item.name.toLowerCase();
      if (['icon', 'icons', 'ico', 'assets', 'images'].includes(dirName)) {
        iconDirs.push(item.name);
      }
    }
  }

  // If no icon in root, check icon directories
  if (!icon && iconDirs.length > 0) {
    for (const dir of iconDirs) {
      if (icon) break; // Stop once we find an icon

      try {
        const dirContents = await fetchRepoContents(owner, repo, dir, branch);
        for (const item of dirContents) {
          if (item.type === 'file' && (item.name.toLowerCase().includes('icon') || iconPatterns.some(p => item.name.toLowerCase().includes(p.split('.')[0])))) {
            icon = `https://github.com/${owner}/${repo}/raw/${branch}/${dir}/${item.name}`;
            break;
          }
        }
      } catch (error) {
        // Directory read failed, skip
      }
    }
  }

  return { userscripts, userstyles, icon };
}

// Function to get the primary author from commit history
async function getPrimaryAuthor(owner, repo) {
  try {
    // Fetch recent commits to find the primary contributor
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=100`;
    const commits = await githubRequest(url);

    if (commits && commits.length > 0) {
      // Count commits per author
      const authorCounts = {};

      for (const commit of commits) {
        if (commit.author && commit.author.login) {
          const login = commit.author.login;
          // Skip bots and automated accounts
          if (!login.includes('[bot]') && login !== 'github-actions') {
            authorCounts[login] = (authorCounts[login] || 0) + 1;
          }
        }
      }

      // Find the author with most commits
      let primaryAuthor = null;
      let maxCommits = 0;

      for (const [login, count] of Object.entries(authorCounts)) {
        if (count > maxCommits) {
          maxCommits = count;
          primaryAuthor = login;
        }
      }

      if (primaryAuthor) {
        // Get the full author info from the commits
        const authorCommit = commits.find(c => c.author && c.author.login === primaryAuthor);
        if (authorCommit && authorCommit.author) {
          return {
            username: authorCommit.author.login,
            url: authorCommit.author.html_url
          };
        }
      }
    }
  } catch (error) {
    // If we can't get commit history, fall back to owner
  }

  return null;
}

// Function to extract author from repository
async function getAuthor(owner, repo, repoData) {
  // First try to get the primary author from commits
  const commitAuthor = await getPrimaryAuthor(owner, repo);
  if (commitAuthor) {
    return commitAuthor;
  }

  // Fall back to repository owner
  if (repoData.owner && repoData.owner.login) {
    return {
      username: repoData.owner.login,
      url: repoData.owner.html_url
    };
  }

  return null;
}

// Function to fetch external repository data
async function fetchExternalRepo(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  try {
    return await githubRequest(url);
  } catch (error) {
    console.error(`Error fetching external repo ${owner}/${repo}: ${error.message}`);
    return null;
  }
}

// Function to process a single repository
async function processRepository(repo) {
  const userscripts = [];
  const userstyles = [];

  // Get default branch first (single API call)
  const branch = repo.default_branch || await getDefaultBranch(repo.owner.login, repo.name);

  // Analyze repository in one go to minimize API calls
  const { userscripts: repoUserscripts, userstyles: repoUserstyles, icon } = await analyzeRepository(repo.owner.login, repo.name, branch);

  if (repoUserscripts.length > 0 || repoUserstyles.length > 0) {
    const author = await getAuthor(repo.owner.login, repo.name, repo);

    // Process userscripts
    for (const script of repoUserscripts) {
      userscripts.push({
        name: repo.name,
        description: repo.description || '',
        author: author,
        repoUrl: repo.html_url,
        installUrl: script.download_url,
        icon: icon,
        archived: repo.archived || false,
        lastUpdated: repo.updated_at || repo.pushed_at || ''
      });
    }

    // Process userstyles
    for (const style of repoUserstyles) {
      userstyles.push({
        name: repo.name,
        description: repo.description || '',
        author: author,
        repoUrl: repo.html_url,
        installUrl: style.download_url,
        icon: icon,
        archived: repo.archived || false,
        lastUpdated: repo.updated_at || repo.pushed_at || ''
      });
    }
  }

  return { userscripts, userstyles };
}

// Function to process repositories and extract relevant information
async function processRepositories() {
  console.log('Fetching repositories from organization...');
  const orgRepos = await fetchOrgRepos();

  const userscripts = [];
  const userstyles = [];

  console.log(`Found ${orgRepos.length} repositories from organization. Processing...`);

  // Process organization repositories
  for (const repo of orgRepos) {
    console.log(`Processing ${repo.name}...`);
    const { userscripts: repoUserscripts, userstyles: repoUserstyles } = await processRepository(repo);
    userscripts.push(...repoUserscripts);
    userstyles.push(...repoUserstyles);
  }

  // Process external repositories
  console.log(`\nProcessing ${EXTERNAL_REPOS.length} external repositories...`);
  for (const { owner, repo: repoName } of EXTERNAL_REPOS) {
    console.log(`Processing external ${owner}/${repoName}...`);
    const repo = await fetchExternalRepo(owner, repoName);
    if (repo) {
      const { userscripts: repoUserscripts, userstyles: repoUserstyles } = await processRepository(repo);
      userscripts.push(...repoUserscripts);
      userstyles.push(...repoUserstyles);
    }
  }

  return { userscripts, userstyles };
}

// Function to format date
function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

// Function to generate markdown table
function generateMarkdownTable(items, type) {
  let markdown = `## ${type}\n\n`;
  markdown += `<table>\n`;
  markdown += `    <thead>\n`;
  markdown += `        <tr>\n`;
  markdown += `            <th>Icon</th>\n`;
  markdown += `            <th>Name</th>\n`;
  markdown += `            <th>Description</th>\n`;
  markdown += `            <th>Author</th>\n`;
  markdown += `            <th>Last Updated</th>\n`;
  markdown += `            <th>Link</th>\n`;
  markdown += `            <th>Install</th>\n`;
  markdown += `        </tr>\n`;
  markdown += `    </thead>\n`;
  markdown += `    <tbody>\n`;

  for (const item of items) {
    markdown += `        <tr>\n`;
    markdown += `            <!-- ${item.name} -->\n`;

    // Icon column
    if (item.icon) {
      markdown += `            <td><img src="${item.icon}" alt="ICON" width="30" height="30"></td>\n`;
    } else {
      markdown += `            <td></td>\n`;
    }

    // Name column with archived badge
    if (item.archived) {
      markdown += `            <td>${item.name} <img src="https://img.shields.io/badge/archived-red" alt="Archived"></td>\n`;
    } else {
      markdown += `            <td>${item.name}</td>\n`;
    }

    // Description column
    markdown += `            <td>${item.description}</td>\n`;

    // Author column
    if (item.author) {
      markdown += `            <td><a href="${item.author.url}">@${item.author.username}</a></td>\n`;
    } else {
      markdown += `            <td></td>\n`;
    }

    // Last Updated column
    markdown += `            <td>${formatDate(item.lastUpdated)}</td>\n`;

    // Link column
    markdown += `            <td><a href="${item.repoUrl}">GitHub</a></td>\n`;

    // Install column
    markdown += `            <td><a href="${item.installUrl}">Install</a></td>\n`;

    markdown += `        </tr>\n`;
  }

  markdown += `    </tbody>\n`;
  markdown += `</table>\n`;

  return markdown;
}

// Main function
async function main() {
  try {
    const { userscripts, userstyles } = await processRepositories();

    console.log(`Found ${userscripts.length} userscripts and ${userstyles.length} userstyles`);

    // Generate markdown content
    let markdownContent = '# All Projects\n\n';

    if (userscripts.length > 0) {
      markdownContent += generateMarkdownTable(userscripts, 'UserScripts');
      markdownContent += '\n';
    }

    if (userstyles.length > 0) {
      markdownContent += generateMarkdownTable(userstyles, 'UserStyles');
      markdownContent += '\n';
    }

    // Write to AllProjects.md
    const outputPath = path.join(process.cwd(), 'AllProjects.md');
    fs.writeFileSync(outputPath, markdownContent, 'utf8');

    console.log('Successfully updated AllProjects.md');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
