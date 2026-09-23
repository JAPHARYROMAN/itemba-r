import { validateAppearance, validateLayout } from './workspace.validation';
describe('workspace storage validation',()=>{
  const window = {id:'one',appId:'invoice-desk',href:'/invoice-desk',mode:'floating',bounds:{x:0,y:0,width:900,height:600}};
  it('rejects cross-origin and wrong-host recovery URLs',()=>{
    for(const href of ['//other.test','javascript:alert(1)','/payroll']) expect(()=>validateLayout({version:1,activeId:'one',windows:[{...window,href}]})).toThrow();
  });
  it('permits independent copies but not duplicate identifiers',()=>{
    expect(validateLayout({version:1,activeId:'one',windows:[window,{...window,id:'two'}]})).toBeTruthy();
    expect(()=>validateLayout({version:1,activeId:'one',windows:[window,window]})).toThrow();
  });
  it('rejects unsupported appearance schema and unsafe accents',()=>{
    expect(()=>validateAppearance({version:2})).toThrow();
    expect(()=>validateAppearance({version:1,theme:'aurora',mode:'light',accent:'url(javascript:1)'})).toThrow();
  });
});
