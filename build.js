#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const { minify } = require('html-minifier-terser');
const { minify: minifyJS } = require('terser');
const CleanCSS = require('clean-css');

const BUILD_DIR = './dist';
const PUBLIC_DIR = './public';

// HTML minification options
const htmlMinifyOptions = {
    removeComments: true,
    removeRedundantAttributes: true,
    removeEmptyAttributes: true,
    removeOptionalTags: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    useShortDoctype: true,
    collapseWhitespace: true,
    conservativeCollapse: true,
    minifyJS: true,
    minifyCSS: true,
    processConditionalComments: true,
    sortAttributes: true,
    sortClassName: true
};

// JavaScript minification options
const jsMinifyOptions = {
    compress: {
        drop_console: false, // Keep console.log for debugging in production
        drop_debugger: true,
        pure_funcs: ['console.debug']
    },
    mangle: true,
    format: {
        comments: false
    }
};

// CSS minification options
const cssMinifyOptions = {
    level: 2,
    returnPromise: false
};

async function cleanBuildDir() {
    console.log('🧹 Cleaning build directory...');
    await fs.emptyDir(BUILD_DIR);
}

async function copyStaticFiles() {
    console.log('📂 Copying static files...');
    
    // Copy non-HTML files from public directory
    const files = await fs.readdir(PUBLIC_DIR);
    
    for (const file of files) {
        const sourceFile = path.join(PUBLIC_DIR, file);
        const destFile = path.join(BUILD_DIR, 'public', file);
        
        const stat = await fs.stat(sourceFile);
        
        if (stat.isFile() && !file.endsWith('.html')) {
            await fs.ensureDir(path.dirname(destFile));
            await fs.copy(sourceFile, destFile);
            console.log(`  ✅ Copied: ${file}`);
        }
    }
}

async function minifyHTMLFiles() {
    console.log('🗜️  Minifying HTML files...');
    
    const htmlFiles = await fs.readdir(PUBLIC_DIR);
    
    for (const file of htmlFiles) {
        if (file.endsWith('.html')) {
            const sourceFile = path.join(PUBLIC_DIR, file);
            const destFile = path.join(BUILD_DIR, 'public', file);
            
            const htmlContent = await fs.readFile(sourceFile, 'utf8');
            
            try {
                const minifiedHTML = await minify(htmlContent, htmlMinifyOptions);
                
                await fs.ensureDir(path.dirname(destFile));
                await fs.writeFile(destFile, minifiedHTML);
                
                const originalSize = Buffer.byteLength(htmlContent, 'utf8');
                const minifiedSize = Buffer.byteLength(minifiedHTML, 'utf8');
                const savings = ((originalSize - minifiedSize) / originalSize * 100).toFixed(1);
                
                console.log(`  ✅ ${file}: ${originalSize} → ${minifiedSize} bytes (${savings}% smaller)`);
            } catch (error) {
                console.error(`  ❌ Error minifying ${file}:`, error.message);
                // Copy original file as fallback
                await fs.copy(sourceFile, destFile);
            }
        }
    }
}

async function copyServerFiles() {
    console.log('📦 Copying server files...');
    
    const serverFiles = [
        'server.js',
        'package.json',
        'app.yaml',
        'service-account-key.json'
    ];
    
    for (const file of serverFiles) {
        if (await fs.pathExists(file)) {
            await fs.copy(file, path.join(BUILD_DIR, file));
            console.log(`  ✅ Copied: ${file}`);
        }
    }
    
    // Copy data directory if it exists
    if (await fs.pathExists('./data')) {
        await fs.copy('./data', path.join(BUILD_DIR, 'data'));
        console.log('  ✅ Copied: data directory');
    }
}

async function updateServerForProduction() {
    console.log('⚙️  Updating server.js for production...');
    
    const serverPath = path.join(BUILD_DIR, 'server.js');
    let serverContent = await fs.readFile(serverPath, 'utf8');
    
    // Add compression middleware and optimize for production
    const compressionMiddleware = `
// Production optimizations
app.use(compression({ level: 9 }));

// Cache static files for 1 hour in production
app.use(express.static('public', {
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
    etag: true,
    lastModified: true
}));
`;
    
    // Insert compression after express setup but before routes
    const expressStaticRegex = /app\.use\(express\.static\(['"`]public['"`]\)\);?/;
    if (expressStaticRegex.test(serverContent)) {
        serverContent = serverContent.replace(
            expressStaticRegex,
            compressionMiddleware.trim()
        );
        
        await fs.writeFile(serverPath, serverContent);
        console.log('  ✅ Added production optimizations to server.js');
    }
}

async function createDeploymentPackageJson() {
    console.log('📋 Creating production package.json...');
    
    const originalPackage = await fs.readJson('./package.json');
    
    // Create a production-only package.json
    const productionPackage = {
        ...originalPackage,
        scripts: {
            start: originalPackage.scripts.start,
            'start:onnx': originalPackage.scripts['start:onnx']
        },
        // Remove devDependencies for production deployment
        devDependencies: undefined
    };
    
    await fs.writeJson(path.join(BUILD_DIR, 'package.json'), productionPackage, { spaces: 2 });
    console.log('  ✅ Created production package.json');
}

async function generateBuildInfo() {
    console.log('📊 Generating build info...');
    
    const buildInfo = {
        buildTime: new Date().toISOString(),
        version: require('./package.json').version,
        nodeVersion: process.version,
        environment: 'production'
    };
    
    await fs.writeJson(path.join(BUILD_DIR, 'build-info.json'), buildInfo, { spaces: 2 });
    console.log('  ✅ Generated build-info.json');
}

async function calculateSavings() {
    console.log('📈 Calculating total savings...');
    
    const publicStats = await getDirectorySize(PUBLIC_DIR);
    const distPublicStats = await getDirectorySize(path.join(BUILD_DIR, 'public'));
    
    const savings = ((publicStats - distPublicStats) / publicStats * 100).toFixed(1);
    
    console.log(`\n📊 Build Summary:`);
    console.log(`  Original public/: ${formatBytes(publicStats)}`);
    console.log(`  Minified public/: ${formatBytes(distPublicStats)}`);
    console.log(`  Space saved: ${formatBytes(publicStats - distPublicStats)} (${savings}%)`);
}

async function getDirectorySize(dirPath) {
    let totalSize = 0;
    
    const files = await fs.readdir(dirPath);
    
    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath);
        
        if (stats.isFile()) {
            totalSize += stats.size;
        }
    }
    
    return totalSize;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function main() {
    console.log('🚀 Starting production build...\n');
    
    const startTime = Date.now();
    
    try {
        await cleanBuildDir();
        await copyStaticFiles();
        await minifyHTMLFiles();
        await copyServerFiles();
        await updateServerForProduction();
        await createDeploymentPackageJson();
        await generateBuildInfo();
        await calculateSavings();
        
        const buildTime = ((Date.now() - startTime) / 1000).toFixed(2);
        
        console.log(`\n✅ Build completed successfully in ${buildTime}s`);
        console.log(`📦 Production files are ready in: ${BUILD_DIR}/`);
        console.log(`🚀 Deploy with: cd ${BUILD_DIR} && gcloud app deploy --quiet`);
        
    } catch (error) {
        console.error('❌ Build failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };
