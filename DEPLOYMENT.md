# Deployment Guide for Minified Production Build

## Overview
This project now includes an automated build system that minifies all static assets before deployment to Google Cloud App Engine. The build system provides significant size reductions and optimizations.

## Quick Deployment

### Option 1: Using npm scripts (Recommended)
```bash
# Build and deploy in one command
npm run deploy

# Or step by step:
npm run build
cd dist && gcloud app deploy --quiet
```

### Option 2: Using the deployment script
```bash
# Deploy to production
./deploy.sh

# Deploy to staging (creates a version without promoting)
./deploy.sh --staging
```

## Build Process Details

### What gets minified:
- **HTML files**: ~40-57% size reduction
  - Removes comments, whitespace, and optional tags
  - Minifies inline CSS and JavaScript
  - Optimizes attributes and class names

- **Static assets**: Copied without modification
  - ONNX model files
  - Other binary assets

### Build output structure:
```
dist/
├── server.js (optimized with compression middleware)
├── package.json (production-only dependencies)
├── app.yaml
├── service-account-key.json
├── build-info.json (build metadata)
├── public/
│   ├── index.html (minified)
│   ├── dataset.html (minified)
│   ├── submit_model.html (minified)
│   ├── *.onnx (copied)
└── data/ (copied)
```

### Performance improvements:
- **Gzip compression** enabled in production
- **Static file caching** with 1-hour cache headers
- **Optimized server.js** with production middleware
- **Reduced deployment size** by excluding dev dependencies

## Build Statistics (Example)
```
Original public/: 119.05 KB
Minified public/: 96.89 KB
Space saved: 22.16 KB (18.6%)
```

## Scripts Available

- `npm run build` - Build minified version to dist/
- `npm run deploy` - Build and deploy to production  
- `npm run build:deploy` - Alias for deploy
- `./deploy.sh` - Advanced deployment with staging options

## File Exclusions

The `.gcloudignore` file has been optimized to exclude:
- Development files (`build.js`, `README.md`, etc.)
- Large datasets (`data/game_dataset.*`)
- Python ML training files
- Source files (deploys from `dist/` instead)

## Staging Deployments

```bash
# Deploy to staging without promoting to production
./deploy.sh --staging
```

This creates a new version without making it the default, allowing you to test before promoting.

## Monitoring

After deployment, the build includes:
- `build-info.json` with build metadata
- Server logs showing compression ratios
- Performance optimizations for high-traffic scenarios

## Troubleshooting

If deployment fails:
1. Check `gcloud auth list` for authentication
2. Verify project ID: `gcloud config get-value project`
3. Ensure all required files are in `dist/` after build
4. Check the build logs for minification errors

## Environment Variables

The build process automatically:
- Sets `NODE_ENV=production` optimizations
- Enables compression middleware
- Configures static file caching
- Optimizes for Google Cloud App Engine
