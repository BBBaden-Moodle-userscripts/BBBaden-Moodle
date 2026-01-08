# Moodle BBBaden Userscripts

## All Projects
Can be viewed [here](AllProjects.md)

The project list is automatically updated daily via GitHub Actions. It scans all repositories in the [BBBaden-Moodle-userscripts](https://github.com/BBBaden-Moodle-userscripts) organization and includes selected external repositories.

## Auto-Update System

This repository uses a GitHub Action to automatically update the [AllProjects.md](AllProjects.md) file with the latest userscripts and userstyles.

### How It Works

The update system:
- Runs automatically **every day at 2 AM UTC**
- Can be **manually triggered** from the Actions tab
- Scans all repositories in the BBBaden-Moodle-userscripts organization
- Includes external repositories configured in `.github/external-repos.json`
- Automatically detects:
  - Userscripts (`.user.js` files, excluding `.lib.user.js` libraries)
  - Userstyles (`.user.css` files)
  - Repository icons (from root or `icon/`, `icons/`, `ico/`, `assets/`, `images/` directories)
  - Primary authors (based on commit history)
  - Repository descriptions

### Adding External Repositories

To include repositories from outside the organization:

1. Edit `.github/external-repos.json`
2. Add the repository in the following format:
   ```json
   {
     "owner": "username",
     "repo": "repository-name"
   }
   ```

Example:
```json
{
  "comment": "Add external repositories here that should be included in the AllProjects.md table",
  "repositories": [
    {
      "owner": "BBBelektronik",
      "repo": "moodle-scrollpos"
    },
    {
      "owner": "Hutch79",
      "repo": "CompactMoodle"
    }
  ]
}
```

3. Commit and push the changes
4. The next automated run (or manual trigger) will include the new repository

### Manual Trigger

To manually update the projects list:

1. Go to the [Actions tab](../../actions)
2. Select "Update Projects Table" workflow
3. Click "Run workflow"
4. Select the branch (usually `main`)
5. Click "Run workflow" button

The action will fetch the latest repository data and update `AllProjects.md` if there are any changes.

## Contributing
If you would like to contribute to any of the projects listed here, feel free to submit a pull request. Contributions are always welcome!
