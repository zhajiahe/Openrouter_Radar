import assert from 'node:assert/strict';
import {test} from 'node:test';
import {contextBrief,contextDisplay,nonTokenModel,outputModalities} from '../web/src/model-display';

test('media output is not treated as free token billing',()=>{
 const video={model_kind:'standard',context_length:0,capabilities_json:JSON.stringify({architecture:{input_modalities:['text','image'],output_modalities:['video']}})};
 assert.equal(nonTokenModel(video),true);
 assert.equal(contextDisplay(video),'未采集 / 不适用');
 assert.equal(contextBrief(video),'上下文未采集 / 不适用');
 assert.deepEqual(outputModalities(video),['video']);
});

test('conventional text models retain token pricing and positive context',()=>{
 const text={model_kind:'standard',context_length:128000,capabilities_json:JSON.stringify({architecture:{output_modalities:['text']}})};
 assert.equal(nonTokenModel(text),false);
 assert.equal(contextDisplay(text),'128,000');
 assert.equal(contextBrief(text),'125K ctx');
});

test('missing and malformed capabilities are handled safely',()=>{
 assert.equal(nonTokenModel({model_kind:'image'}),true);
 assert.equal(nonTokenModel({model_kind:'standard',capabilities_json:'{broken'}),false);
 assert.equal(contextDisplay({context_length:0}),'未采集 / 不适用');
 assert.deepEqual(outputModalities({capabilities_json:'{broken'}),[]);
});
