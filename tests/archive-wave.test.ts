import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveWave } from '../src/scene/ArchiveWave.ts';
test('wave is visibly stronger but stays above the floor and changes smoothly',()=>{
 const values=Array.from({length:200},(_,i)=>archiveWave(1.2,-4.6,i*80,0));
 assert.ok(Math.max(...values)-Math.min(...values)>.65);
 assert.ok(Math.min(...values)>=0);assert.ok(Math.max(...values)<=1.05);
 for(let i=1;i<values.length;i++)assert.ok(Math.abs(values[i]-values[i-1])<.06);
});
test('wave propagates continuously across real and background positions and fades in detail',()=>{
 const x=.4,z=-9.2,time=2500;
 assert.ok(Math.abs(archiveWave(x,z,time,0)-archiveWave(x+.001,z,time,0))<.001);
 assert.notEqual(archiveWave(x,z,time,0),archiveWave(x+.48,z,time,0));
 assert.equal(archiveWave(x,z,time,1),0);
 assert.ok(archiveWave(x,z,time,.8)<archiveWave(x,z,time,.2));
});
