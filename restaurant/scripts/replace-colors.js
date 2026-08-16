const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      if (file.endsWith('.tsx') || file.endsWith('.ts')) {
        results.push(file);
      }
    }
  });
  return results;
}

const dir = 'c:\\Users\\Akanksha Singh\\Downloads\\Food-Delivery-App\\delivery\\restaurant\\components\\delivery';
const files = walk(dir);

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');

  if (content.match(/#FFA726/i) || content.match(/#FF8A00/i) || content.match(/BRAND_YELLOW/g)) {
    content = content.replace(/#FFA726/gi, '#EA4B14');
    content = content.replace(/#FF8A00/gi, '#EA4B14');
    content = content.replace(/BRAND_YELLOW/g, "'#EA4B14'");
    
    // Check if BRAND_YELLOW import exists and remove it if it's no longer used
    content = content.replace(/, BRAND_YELLOW/g, '');
    content = content.replace(/BRAND_YELLOW, /g, '');

    fs.writeFileSync(file, content);
    console.log('Updated', file);
  }
});
