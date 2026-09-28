import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readControlState} from './office.js';

test('snapshot uses getter methods only and maps the 9.2.1 property enums', async () => {
  const connector = {
    executeMethod(name,args,callback) {
      assert.equal(name,'GetAllContentControls');
      callback([0,1,2,3].map((lock,i)=>({Tag:'tag-'+i,InternalId:String(i),Lock:lock,Appearance:i%2+1})));
    },
    callCommand() { assert.fail('State reads must not enter the editing command history'); },
  };
  const result=await readControlState(connector);
  assert.deepEqual(result.controls.map(c=>c.lock),['contentLocked','sdtContentLocked','sdtLocked','unlocked']);
  assert.deepEqual(result.controls.map(c=>c.appearance),['boundingBox','hidden','boundingBox','hidden']);
});
