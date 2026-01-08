#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ORG_NAME = 'BBBaden-Moodle-userscripts';

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

// Function to fetch repository contents to find userscripts
async function fetchRepoContents(owner, repo, path = '') {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  try {
    return await githubRequest(url);
  } catch (error) {
    console.error(`Error fetching contents for ${owner}/${repo}: ${error.message}`);
    return [];
  }
}

// Function to search for userscript/userstyle files in a repository
async function findUserscriptFiles(owner, repo) {
  const contents = await fetchRepoContents(owner, repo);
  const userscripts = [];
  const userstyles = [];

  for (const item of contents) {
    if (item.type === 'file') {
      if (item.name.endsWith('.user.js')) {
        userscripts.push(item);
      } else if (item.name.endsWith('.user.css')) {
        userstyles.push(item);
      }
    }
  }

  return { userscripts, userstyles };
}

// Function to find icon in repository
async function findIcon(owner, repo) {
  const contents = await fetchRepoContents(owner, repo);
  const iconPatterns = ['icon.svg', 'icon.png', 'icon.jpg'];

  // Check root directory
  for (const item of contents) {
    if (item.type === 'file' && iconPatterns.includes(item.name.toLowerCase())) {
      return `https://github.com/${owner}/${repo}/raw/main/${item.name}`;
    }
  }

  // Check common icon directories
  const iconDirs = ['icon', 'icons', 'ico', 'assets', 'images'];
  for (const dir of iconDirs) {
    try {
      const dirContents = await fetchRepoContents(owner, repo, dir);
      for (const item of dirContents) {
        if (item.type === 'file' && (item.name.toLowerCase().includes('icon') || iconPatterns.some(p => item.name.toLowerCase().includes(p.split('.')[0])))) {
          return `https://github.com/${owner}/${repo}/raw/main/${dir}/${item.name}`;
        }
      }
    } catch (error) {
      // Directory doesn't exist, continue
    }
  }

  return null;
}

// Function to extract author from repository
function getAuthor(repo) {
  // Try to get from owner
  if (repo.owner && repo.owner.login) {
    return {
      username: repo.owner.login,
      url: repo.owner.html_url
    };
  }
  return null;
}

// Function to process repositories and extract relevant information
async function processRepositories() {
  console.log('Fetching repositories from organization...');
  const repos = await fetchOrgRepos();

  const userscripts = [];
  const userstyles = [];

  console.log(`Found ${repos.length} repositories. Processing...`);

  for (const repo of repos) {
    console.log(`Processing ${repo.name}...`);

    const { userscripts: repoUserscripts, userstyles: repoUserstyles } = await findUserscriptFiles(repo.owner.login, repo.name);

    if (repoUserscripts.length > 0 || repoUserstyles.length > 0) {
      const icon = await findIcon(repo.owner.login, repo.name);
      const author = getAuthor(repo);

      // Process userscripts
      for (const script of repoUserscripts) {
        userscripts.push({
          name: repo.name,
          description: repo.description || '',
          author: author,
          repoUrl: repo.html_url,
          installUrl: script.download_url,
          icon: icon
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
          icon: icon
        });
      }
    }
  }

  return { userscripts, userstyles };
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

    // Name column
    markdown += `            <td>${item.name}</td>\n`;

    // Description column
    markdown += `            <td>${item.description}</td>\n`;

    // Author column
    if (item.author) {
      markdown += `            <td><a href="${item.author.url}">@${item.author.username}</a></td>\n`;
    } else {
      markdown += `            <td></td>\n`;
    }

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
