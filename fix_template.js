import fs from 'fs';

const files = [
    'src/modules/wbs/events.js',
    'src/modules/wbs/view.js'
];

for (let file of files) {
    let content = fs.readFileSync(file, 'utf8');
    content = content.replace(/\\`/g, '`');
    content = content.replace(/\\\$\{/g, '${');
    fs.writeFileSync(file, content);
}
console.log('Fixed syntax templates');
