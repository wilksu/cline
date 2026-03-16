import fs from 'fs';
import path from 'path';

const CLINE_ROOT = process.env.CLINE_DIR || process.cwd();

const patchFiles = () => {
    console.log(`[Patch] Target directory: ${CLINE_ROOT}`);

    // --- 1. 修改 src/extension.ts ---
    const extPath = path.join(CLINE_ROOT, 'src/extension.ts');
    if (fs.existsSync(extPath)) {
        let extContent = fs.readFileSync(extPath, 'utf8');
        
        // 注入 Import
        if (!extContent.includes('./services/ws-bridge')) {
            extContent = 'import { WsBridge } from "./services/ws-bridge";\n' + extContent;
            console.log("✅ Injected Import into extension.ts");
        }
        
        // 注入启动点 (寻找 activate 函数起始位置)
        const activateRegex = /export async function activate\(context: vscode\.ExtensionContext\) \{/;
        if (extContent.match(activateRegex) && !extContent.includes('WsBridge.register(context)')) {
            extContent = extContent.replace(activateRegex, 
                `$&\n\t// WS-Bridge Patch\n\tWsBridge.register(context);`);
            console.log("✅ Injected WsBridge.register into activate function");
        }
        fs.writeFileSync(extPath, extContent);
    }

    // --- 2. 修改 package.json ---
    const pkgPath = path.join(CLINE_ROOT, 'package.json');
    if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        
        // 注入命令定义 (确保幂等)
        const bridgeCommands = [
            { "command": "cline.wsBridge.start", "title": "Start WebSocket Bridge", "category": "Cline" },
            { "command": "cline.wsBridge.stop", "title": "Stop WebSocket Bridge", "category": "Cline" }
        ];

        pkg.contributes = pkg.contributes || {};
        pkg.contributes.commands = pkg.contributes.commands || [];
        
        bridgeCommands.forEach(newCmd => {
            if (!pkg.contributes.commands.find(c => c.command === newCmd.command)) {
                pkg.contributes.commands.push(newCmd);
            }
        });

        // 注入依赖项 (解决 TS7016 编译错误)
        pkg.devDependencies = pkg.devDependencies || {};
        if (!pkg.devDependencies["@types/ws"]) {
            pkg.devDependencies["@types/ws"] = "^8.5.10";
            console.log("✅ Added @types/ws to devDependencies");
        }
        if (!pkg.dependencies["ws"]) {
            pkg.dependencies["ws"] = "^8.17.1";
            console.log("✅ Added ws to dependencies");
        }

        // 注入配置项
        pkg.contributes.configuration = pkg.contributes.configuration || { properties: {} };
        const config = pkg.contributes.configuration.properties;
        if (!config["cline.wsBridge.enabled"]) {
            Object.assign(config, {
                "cline.wsBridge.enabled": { 
                    "type": "boolean", 
                    "default": false, 
                    "scope": "resource",
                    "description": "Enable WebSocket bridge" 
                },
                "cline.wsBridge.port": { 
                    "type": "number", 
                    "default": 3456, 
                    "scope": "resource",
                    "description": "WebSocket server port" 
                },
                "cline.wsBridge.autoStart": { 
                    "type": "boolean", 
                    "default": false, 
                    "scope": "resource",
                    "description": "Auto-start WebSocket server" 
                }
            });
        }

        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, "\t"));
        console.log("✅ package.json patched.");
    }
};

try {
    patchFiles();
} catch (error) {
    console.error(`❌ Patch failed: ${error.message}`);
    process.exit(1);
}
