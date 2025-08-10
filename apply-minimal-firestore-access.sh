#!/bin/bash

# Script to apply minimal Firestore access rights for security
# Run this after confirming your application works correctly

set -e

PROJECT_ID="clickthemovingdot"
SERVICE_ACCOUNT="clickthemovingdot-service@${PROJECT_ID}.iam.gserviceaccount.com"
CUSTOM_ROLE_ID="clickMovingDotFirestoreMinimal"

echo "🔒 Applying minimal Firestore access rights..."

# 1. Create custom role with minimal permissions
echo "📝 Creating custom role with minimal permissions..."
gcloud iam roles create $CUSTOM_ROLE_ID \
    --project=$PROJECT_ID \
    --file=firestore-minimal-role.yaml \
    --quiet || echo "Role already exists, updating..."

# Update role if it already exists
gcloud iam roles update $CUSTOM_ROLE_ID \
    --project=$PROJECT_ID \
    --file=firestore-minimal-role.yaml \
    --quiet

# 2. Remove the overly broad datastore.user role
echo "🗑️  Removing overly broad datastore.user role..."
gcloud projects remove-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/datastore.user" \
    --quiet

# 3. Assign the minimal custom role
echo "✅ Assigning minimal custom role..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="projects/$PROJECT_ID/roles/$CUSTOM_ROLE_ID" \
    --quiet

echo "🎉 Minimal Firestore access rights applied successfully!"
echo ""
echo "📊 Current service account permissions:"
echo "  ✅ Custom Firestore access (minimal)"
echo "  ✅ BigQuery dataEditor & jobUser" 
echo "  ✅ Storage objectAdmin"
echo "  ✅ Cloud Build builder"
echo ""
echo "⚠️  IMPORTANT: Test your application thoroughly to ensure it still works!"
echo "   If something breaks, you can revert with:"
echo "   gcloud projects add-iam-policy-binding $PROJECT_ID \\"
echo "     --member='serviceAccount:$SERVICE_ACCOUNT' \\"
echo "     --role='roles/datastore.user'"
