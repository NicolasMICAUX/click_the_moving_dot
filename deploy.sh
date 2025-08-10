#!/bin/bash

# Deploy script for minified production build
# Usage: ./deploy.sh [--staging|--production]

set -e

# Default to production
ENVIRONMENT="production"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --staging)
      ENVIRONMENT="staging"
      shift
      ;;
    --production)
      ENVIRONMENT="production"
      shift
      ;;
    *)
      echo "Unknown option $1"
      echo "Usage: $0 [--staging|--production]"
      exit 1
      ;;
  esac
done

echo "🚀 Deploying to $ENVIRONMENT environment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: package.json not found. Please run this script from the project root.${NC}"
    exit 1
fi

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}❌ Error: gcloud CLI is not installed or not in PATH${NC}"
    echo "Please install the Google Cloud SDK: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if we're authenticated with gcloud
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo -e "${YELLOW}⚠️  Warning: No active gcloud authentication found${NC}"
    echo "Please run: gcloud auth login"
    exit 1
fi

echo -e "${BLUE}📦 Step 1: Building production assets...${NC}"
npm run build

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed!${NC}"
    exit 1
fi

echo -e "${BLUE}📁 Step 2: Preparing deployment directory...${NC}"
cd dist

# Check if all required files are present
REQUIRED_FILES=("server.js" "package.json" "app.yaml" "public/index.html")
for file in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo -e "${RED}❌ Error: Required file $file not found in dist directory${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✅ All required files found${NC}"

# Install production dependencies in the dist folder
echo -e "${BLUE}📦 Installing production dependencies...${NC}"
npm install --only=production

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Failed to install production dependencies!${NC}"
    exit 1
fi

# Modify app.yaml for different environments if needed
if [ "$ENVIRONMENT" = "staging" ]; then
    echo -e "${BLUE}🔧 Configuring for staging environment...${NC}"
    # You can add staging-specific configurations here
    # For example, different scaling settings or environment variables
fi

echo -e "${BLUE}🚀 Step 3: Deploying to Google Cloud App Engine...${NC}"

# Set the project (make sure it's the right one)
CURRENT_PROJECT=$(gcloud config get-value project)
echo -e "${BLUE}📋 Current project: $CURRENT_PROJECT${NC}"

# Deploy based on environment
if [ "$ENVIRONMENT" = "staging" ]; then
    echo -e "${YELLOW}🔄 Deploying to staging...${NC}"
    gcloud app deploy --version="staging-$(date +%Y%m%d-%H%M%S)" --no-promote --quiet
    echo -e "${GREEN}✅ Staging deployment complete!${NC}"
    echo -e "${BLUE}🌐 Staging URL: https://staging-$(date +%Y%m%d-%H%M%S)-dot-$CURRENT_PROJECT.appspot.com${NC}"
else
    echo -e "${YELLOW}🔄 Deploying to production...${NC}"
    gcloud app deploy --quiet
    echo -e "${GREEN}✅ Production deployment complete!${NC}"
    echo -e "${BLUE}🌐 Production URL: https://$CURRENT_PROJECT.appspot.com${NC}"
fi

echo -e "${BLUE}📊 Step 4: Deployment summary...${NC}"
cd ..

# Calculate deployment size
DIST_SIZE=$(du -sh dist/ | cut -f1)
ORIGINAL_SIZE=$(du -sh public/ | cut -f1)

echo -e "${GREEN}📈 Deployment Statistics:${NC}"
echo -e "  Original public/ size: $ORIGINAL_SIZE"
echo -e "  Deployed dist/ size: $DIST_SIZE"
echo -e "  Environment: $ENVIRONMENT"
echo -e "  Timestamp: $(date)"

echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
