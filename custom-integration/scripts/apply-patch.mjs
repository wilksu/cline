import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// 在 ESM 中模拟 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '../../');
const EXTENSION_TS = path.join(PROJECT_ROOT, 'src/extension.ts');
const CUSTOM_DIR = path.join(PROJECT_ROOT, 'custom-integration');
const TARGET_DIR = path.join(PROJECT_ROOT, 'src/services/ws-bridge');

async function patch() {
    const isDev = process.argv.includes('--dev');
    console.log(`🚀 Applying patch in ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'} mode...`);

    // 1. 同步代码
    if (fs.existsSync(TARGET_DIR)) {
        // 如果是符号链接，需要用 unlinkSync
        const stats = fs.lstatSync(TARGET_DIR);
        if (stats.isSymbolicLink()) {
            fs.unlinkSync(TARGET_DIR);
        } else {
            fs.rmSync(TARGET_DIR, { recursive: true, force: true });
        }
    }

    if (isDev) {
        // 开发模式：创建符号链接
        fs.symlinkSync(path.join(CUSTOM_DIR, 'src'), TARGET_DIR, 'dir');
        console.log('🔗 Created symlink for live debugging.');
    } else {
        // 生产模式：物理复制
        fs.mkdirSync(TARGET_DIR, { recursive: true });
        // 使用 Node.js 原生递归复制逻辑，确保跨平台稳定性
        const sourceSrc = path.join(CUSTOM_DIR, 'src');
        fs.cpSync(sourceSrc, TARGET_DIR, { recursive: true });
        console.log('📦 Physically copied files to src/services/ws-bridge');
    }

    // 2. 注入依赖并合并配置
    const customPkg = JSON.parse(fs.readFileSync(path.join(CUSTOM_DIR, 'package.json'), 'utf8'));
    
    // 合并依赖 (仅展示，实际打包建议手动运行 npm install)
    const deps = Object.keys(customPkg.dependencies).join(' ');
    console.log(`📦 Note: Make sure to 'npm install ${deps}' if not already present.`);

    // 合并 Configuration 到原生 package.json
    const nativePkgPath = path.join(PROJECT_ROOT, 'package.json');
    const nativePkg = JSON.parse(fs.readFileSync(nativePkgPath, 'utf8'));
    
    if (customPkg.contributes?.configuration) {
        if (!nativePkg.contributes) nativePkg.contributes = {};
        if (!nativePkg.contributes.configuration) nativePkg.contributes.configuration = { properties: {} };
        
        nativePkg.contributes.configuration.properties = {
            ...nativePkg.contributes.configuration.properties,
            ...customPkg.contributes.configuration.properties
        };
        fs.writeFileSync(nativePkgPath, JSON.stringify(nativePkg, null, 2));
        console.log('📝 Merged custom configuration into package.json');
    }

    // 3. 注入入口 (增加幂等性检查)
    let content = fs.readFileSync(EXTENSION_TS, 'utf8');
    const injection = `\n\t// @custom-inject-start\n\t;(await import("./services/ws-bridge/bridge")).bootstrap(context);\n\t// @custom-inject-end\n`;
    
    if (!content.includes('ws-bridge/bridge')) {
        // 寻找 activate 函数中的 Logger 锚点
        const anchor = 'Logger.log("Cline extension activated")';
        if (content.includes(anchor)) {
            content = content.replace(anchor, `${anchor}${injection}`);
            fs.writeFileSync(EXTENSION_TS, content);
            console.log('✅ Injected bootstrap into extension.ts');
        } else {
            console.warn('⚠️ Could not find anchor in extension.ts, please check the file structure.');
        }
    } else {
        console.log('ℹ️ Entry point already exists, skipping injection.');
    }
}

patch().catch(console.error);
