const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { comparisonGroups, listingStorageGb, listingCarbon, greenActions, validateBackup } = require("../ui/impact.js");

function history() {
  const data = {};
  const context = vm.createContext({ Date, URL, chrome: { storage: { local: {
    get: async (key) => ({ [key]: data[key] }),
    set: async (values) => Object.assign(data, values),
  } } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../ui/impact.js"), "utf8"), context);
  const run = (code) => vm.runInContext(code, context);
  return { data, run };
}

const decision = `makeChoice(
  {key:'low',name:'Lower phone',kind:'device',brand:'Apple',category:'phone',carbonKg:40,carbonBasis:'128GB model'},
  {key:'high',name:'Other phone',kind:'device',brand:'Apple',category:'phone',carbonKg:60,carbonBasis:'128GB model'})`;

test("card purchase confirmation updates its choice and does not duplicate on retry", async () => {
  const { data, run } = history();
  await run(`saveChoice(${decision})`);
  await run(`logPurchase(productSnapshot({key:'low',name:'Lower phone',kg:40,basis:'reported'}))`);
  await run(`logPurchase(productSnapshot({key:'low',name:'Lower phone',kg:40,basis:'reported'}))`);
  assert.equal(data.choices[0].stage, "purchased");
  assert.equal(data.purchases.length, 1);
  assert.equal(data.purchases[0].choiceId, data.choices[0].id);
});

test("dashboard purchase confirmation creates history, and undo keeps both stores consistent", async () => {
  const { data, run } = history();
  await run(`saveChoice(${decision})`);
  await run(`setChoiceStage('low>high','purchased')`);
  assert.equal(data.purchases[0].kg, 40);
  assert.equal(data.purchases[0].reportBasis, "128GB model");
  await run(`setChoiceStage('low>high','chosen')`);
  assert.equal(data.purchases.length, 0);
  assert.equal(data.choices[0].purchasedAt, null);
});

test("removing the linked purchase restores the choice to chosen", async () => {
  const { data, run } = history();
  await run(`saveChoice(${decision})`);
  await run(`setChoiceStage('low>high','purchased')`);
  await run(`removePurchase(${JSON.stringify(data.purchases[0].id)})`);
  assert.equal(data.choices[0].stage, "chosen");
});

test("removing either shortlist candidate preserves purchased history", async () => {
  const { data, run } = history();
  await run(`saveChoice(${decision})`);
  await run(`setChoiceStage('low>high','purchased')`);
  await run(`removeFromShortlist('high')`);
  await run(`removeFromShortlist('low')`);
  assert.equal(data.choices[0].stage, "purchased");
  assert.equal(data.purchases.length, 1);
});

test("charts never group different appliance sizes or report bases", () => {
  const fridge = (key, value) => ({key, kind:"appliance", type:"fridge", kwhYear:200, capacity:{value,unit:"litres"}});
  assert.equal(comparisonGroups([fridge("a",190),fridge("b",200),fridge("c",350)]).length, 2);
  // Similarity is not transitive: every pair in a group must satisfy the rule.
  assert.equal(comparisonGroups([fridge("a",190),fridge("b",210),fridge("c",230)]).length, 2);
  const phone = (key, basis) => ({key,kind:"device",category:"phone",brand:"Apple",carbonKg:40,carbonBasis:basis});
  assert.equal(comparisonGroups([phone("a","128GB model"),phone("b","256GB model")]).length, 2);
});

test("storage mismatches, missing storage and unverified regions are reference reports only", () => {
  const card = {carbon:{kg:56,basis:"128GB model"}};
  assert.equal(listingCarbon(card,{title:"iPhone 16 128GB"}).carbon.kg,56);
  assert.equal(listingCarbon(card,{title:"iPhone 16 512GB"}).carbon,null);
  assert.equal(listingCarbon(card,{title:"iPhone 16"}).carbon,null);
  assert.equal(listingCarbon({carbon:{kg:38,basis:"EU model SM-A566B"}},{title:"Galaxy A56"}).carbon,null);
  assert.equal(listingCarbon({carbon:{kg:38,basis:"EU/UK model SM-S931B"}},{title:"Galaxy S25"}).carbon,null);
  assert.equal(listingCarbon({carbon:{kg:150,basis:"M5, 8-core GPU, 16GB, 512GB"}},{title:"MacBook M5 16GB RAM 512GB SSD"}).carbon,null);
  assert.equal(listingCarbon({carbon:{kg:150,basis:"M5, 8-core GPU, 16GB, 512GB"}},{title:"MacBook M5 16GB RAM 512GB SSD 8-core GPU"}).carbon.kg,150);
});

test("the plant excludes equal and worse choices", () => {
  const choices = [40,60,70].map(value=>({stage:"chosen",chosen:{value},instead:{value:60}}));
  assert.equal(greenActions([],choices),1);
});

test("listing storage is distinct from RAM and ambiguous capacities stay unknown", () => {
  assert.equal(listingStorageGb({title:"Phone 12GB RAM, 256GB Storage"}),256);
  assert.equal(listingStorageGb({title:"Laptop RAM: 16GB, 512GB SSD"}),512);
  assert.equal(listingStorageGb({title:"Phone 128GB or 256GB"}),null);
  assert.equal(listingStorageGb({title:"Phone",details:{"Memory Storage Capacity":"256 GB","RAM":"12 GB"}}),256);
});

test("backup validation rejects invalid types, stages, values, URLs and versions before storage", () => {
  const backup = data => ({app:"EcoCart",version:1,savedAt:"2026-10-11T10:00:00Z",data});
  const keys = ["choices","purchases","shortlist"];
  assert.throws(()=>validateBackup(backup({choices:{}}),keys));
  assert.throws(()=>validateBackup({...backup({}),version:2},keys));
  assert.throws(()=>validateBackup(backup({purchases:[{id:"p",key:"p",name:"Phone",at:"bad"}]}),keys));
  assert.throws(()=>validateBackup(backup({shortlist:[{key:"a",name:"A",kind:"device",url:"javascript:alert(1)"}]}),keys));
  assert.throws(()=>validateBackup(backup({choices:[{id:"a",stage:"invalid"}]}),keys));
  assert.deepEqual(validateBackup(backup({choices:[],purchases:[],unexpected:"ignored"}),keys),{choices:[],purchases:[]});
});
