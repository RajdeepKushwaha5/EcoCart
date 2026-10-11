const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

test("search retries a failed batch and waits for a late price without duplicating badges", async () => {
  let price = null;
  let fail = true;
  let calls = 0;
  const attributes = new Map();
  const badges = [];
  const node = { getAttribute:key=>attributes.get(key),setAttribute:(key,value)=>attributes.set(key,value),
    removeAttribute:key=>attributes.delete(key),querySelectorAll:()=>badges.map(b=>({remove:()=>badges.splice(badges.indexOf(b),1)})) };
  const context = vm.createContext({ SITE:{searchResults:()=>[{node,title:"Tea",anchor:{after:b=>badges.push(b)}}],resultPrice:()=>price},
    api:async method=>{if(method==="GET")return {products:[]};calls++;if(fail)throw Error("offline");return {results:[{kg:2}]};},
    matchByAlias:()=>null,listingCertifications:()=>[],setTimeout:()=>{},console });
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../content/search.js"),"utf8"),context);
  vm.runInContext("estimateBadge = () => ({})",context);
  const run=()=>vm.runInContext("badgeResults()",context);
  await run(); assert.equal(calls,0);
  price=100; await run(); assert.equal(calls,1);
  fail=false; await run(); assert.equal(calls,2); assert.equal(badges.length,1);
  await run(); assert.equal(calls,2); assert.equal(badges.length,1);
  price=80; await run(); assert.equal(calls,3); assert.equal(badges.length,1);
});
