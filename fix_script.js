const fs = require('fs');
const files = ['src/modules/wbs/view.js', 'src/modules/wbs/events.js'];
for (const f of files) {
    let content = fs.readFileSync(f, 'utf8');
    content = content.replace(/\\\`/g, '`');
    content = content.replace(/\\\$\{/g, '${');
    fs.writeFileSync(f, content);
    console.log(`Fixed ${f}`);
}
