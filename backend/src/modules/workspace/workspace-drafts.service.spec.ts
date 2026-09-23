import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkspaceDraftsService } from './workspace-drafts.service';
import { EncryptionService } from '../../common/services/encryption.service';

describe('private workspace draft lifecycle',()=>{
  let service: WorkspaceDraftsService, row: any, policy: any;
  const user:any={id:'owner',permissions:['invoice_desk.manage','invoice_desk.view']};
  const content={title:'Private invoice',context:{kind:'invoice',companyId:'company'},values:{companyId:'company',description:'Confidential purchase'},requestId:'transaction-identity',needsReview:true};
  const input=(expectedRevision=0,leaseToken='device-a-private-lease')=>({appId:'invoice-desk',formType:'invoice-desk:invoice:v1',schemaVersion:1,expectedRevision,leaseToken,content});
  beforeEach(()=>{
    row=null;
    const encryption=new EncryptionService({get:(key:string)=>key==='APP_ENCRYPTION_KEY'?'test-only-key-32-characters-long-enough':undefined} as any);encryption.onModuleInit();
    const drafts={findUnique:jest.fn(async()=>row),findFirst:jest.fn(async({where}:any)=>row?.userId===where.userId?row:null),count:jest.fn(async()=>row?1:0),findMany:jest.fn(async()=>row?[row]:[]),upsert:jest.fn(async({create,update}:any)=>{row=row?{...row,...update,revision:row.revision+1,updatedAt:new Date()}:{...create,revision:1,updatedAt:new Date()};return row;}),update:jest.fn(async({data}:any)=>{row={...row,...data};return row;}),delete:jest.fn(async()=>{row=null;})};
    const prisma:any={workspaceDraft:drafts,$executeRaw:jest.fn(),$transaction:async(fn:any)=>fn(prisma)};
    policy={authorize:jest.fn(async()=>({companyId:'company',divisionId:null,branchId:null}))};
    service=new WorkspaceDraftsService(prisma,encryption,{owner:(u:any)=>u.id} as any,policy);
  });
  it('encrypts business inputs and restores them only to their owner',async()=>{
    await service.save(user,'draft',input());
    expect(row.encryptedContent).not.toContain('Confidential purchase');expect(row.encryptedContent).toMatch(/^v1:/);
    expect((await service.get(user,'draft')).values).toEqual(content.values);
    await expect(service.get({...user,id:'another'},'draft')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejects another device and a stale revision without replacing the saved draft',async()=>{
    await service.save(user,'draft',input());
    await expect(service.lease(user,'draft',{expectedRevision:1,leaseToken:'device-b-private-lease'})).rejects.toBeInstanceOf(ConflictException);
    await expect(service.save(user,'draft',input(0))).rejects.toBeInstanceOf(ConflictException);
    expect(row.revision).toBe(1);
  });
  it('requires current permissions for reads, writes, leases and discard',async()=>{
    await service.save(user,'draft',input());policy.authorize.mockRejectedValue(new ForbiddenException());
    await expect(service.get(user,'draft')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.save(user,'draft',input(1))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.lease(user,'draft',{expectedRevision:1,leaseToken:'device-a-private-lease'})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.discard(user,'draft',{expectedRevision:1,leaseToken:'device-a-private-lease'})).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('allows a new editor after expiry but protects the original transaction identity',async()=>{
    await service.save(user,'draft',input());row.leaseUntil=new Date(0);
    await service.lease(user,'draft',{expectedRevision:1,leaseToken:'device-b-private-lease'});
    await expect(service.save(user,'draft',{...input(1,'device-b-private-lease'),content:{...content,requestId:'replacement'}})).rejects.toBeInstanceOf(ConflictException);
    expect((await service.get(user,'draft')).requestId).toBe('transaction-identity');
  });
});
