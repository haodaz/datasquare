import xlsx from 'xlsx';
const workbook = xlsx.readFile('/Users/aisandbox/Documents/datasquare/人才检索工具带回字段.xlsx');
console.log('Sheet Names:', workbook.SheetNames);
for (const sheetName of workbook.SheetNames) {
  console.log(`\n--- Sheet: ${sheetName} ---`);
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  console.log(data);
}
