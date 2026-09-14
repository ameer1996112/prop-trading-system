#property strict
#property script_show_inputs
#property version "1.000"
#property description "Offline deterministic and native FILE_COMMON telemetry store tests"
#include "../Include/TradeOpsTelemetryFileStore.mqh"

input string TestMode="LOCAL";
input int HoldSeconds=30;

const string TOV2_NATIVE_IDENTITY="native.storage.20260904.01";
const string TOV2_NATIVE_KEY="0a0c1e55bac97da98734ad83c7310d90f1cea4c526c366fe882daf3347873668";
const long TOV2_NATIVE_LOCAL_GENERATION=7000001;
const long TOV2_NATIVE_FIXTURE_GENERATION=7000101;

int tov2_file_checks=0;
int tov2_file_failures=0;

void Check(const bool ok,const string label)
{
   tov2_file_checks++;
   if(!ok)
   {
      tov2_file_failures++;
      Print("TOV2_FILE_STORE_FAILURE ",label);
   }
}

bool SameBytes(const uchar &left[],const uchar &right[])
{
   int count=ArraySize(left);
   if(count!=ArraySize(right)) return false;
   for(int i=0;i<count;i++) if(left[i]!=right[i]) return false;
   return true;
}

bool MakeFrame(const long generation,const int variant,uchar &frame[])
{
   uchar payload[];
   if(ArrayResize(payload,6)!=6) return false;
   payload[0]=(uchar)variant;
   payload[1]=0;
   payload[2]=255;
   payload[3]=128;
   payload[4]=10;
   payload[5]=65;
   return Tov2RecordEncode("EVENT",generation,payload,frame);
}

string NativeRoot()
{
   return TOV2_FILE_STORE_NAMESPACE+TOV2_FILE_STORE_SEPARATOR+TOV2_NATIVE_KEY;
}

string NativePath(const Tov2StorageLocator &locator)
{
   string relative=Tov2StorageRelativePath(locator);
   StringReplace(relative,TOV2_FILE_STORE_FORWARD,TOV2_FILE_STORE_SEPARATOR);
   return NativeRoot()+TOV2_FILE_STORE_SEPARATOR+relative;
}

class CTov2DeterministicFileOps : public ITov2TelemetryFileOps
{
private:
   string m_path[];
   bool m_directory[];
   bool m_active[];
   long m_size[];
   string m_hex[];
   int m_handle_node[];
   long m_handle_position[];
   bool m_handle_open[];
   string m_search_parent[];
   int m_search_cursor[];
   bool m_search_open[];
   bool m_external_owner;
   int m_open_fault;
   int m_read_fault;
   int m_write_fault;
   int m_flush_fault;
   int m_close_fault;
   int m_find_next_fault;
   int m_find_close_fault;
   int m_resize_bytes_fault;
   int m_resize_entries_fault;
   int m_copy_fault;
   int m_hash_fault;
   int m_path_fault;
   bool m_short_read;
   bool m_short_write;
   bool m_native_exhaustion_error;
   int m_opened_files;
   int m_closed_files;
   int m_opened_searches;
   int m_closed_searches;

   bool FaultNow(int &countdown)
   {
      if(countdown<0) return false;
      if(countdown==0)
      {
         countdown=-1;
         return true;
      }
      countdown--;
      return false;
   }

   int Node(const string path)
   {
      for(int i=0;i<ArraySize(m_path);i++)
         if(m_active[i] && m_path[i]==path) return i;
      return -1;
   }

   int AddNode(const string path,const bool directory,const long size,
               const string hex)
   {
      int count=ArraySize(m_path);
      if(ArrayResize(m_path,count+1)!=count+1 ||
         ArrayResize(m_directory,count+1)!=count+1 ||
         ArrayResize(m_active,count+1)!=count+1 ||
         ArrayResize(m_size,count+1)!=count+1 ||
         ArrayResize(m_hex,count+1)!=count+1) return -1;
      m_path[count]=path;
      m_directory[count]=directory;
      m_active[count]=true;
      m_size[count]=size;
      m_hex[count]=hex;
      return count;
   }

   string ParentOf(const string path)
   {
      int last=-1;
      for(int i=0;i<StringLen(path);i++)
         if(StringGetCharacter(path,i)==92) last=i;
      return last<0 ? "" : StringSubstr(path,0,last);
   }

   string NameOf(const string path)
   {
      int last=-1;
      for(int i=0;i<StringLen(path);i++)
         if(StringGetCharacter(path,i)==92) last=i;
      return StringSubstr(path,last+1);
   }

   string BytesHex(const uchar &bytes[],const int count)
   {
      string result="";
      for(int i=0;i<count;i++) result+=StringFormat("%02x",bytes[i]);
      return result;
   }

   int Nibble(const ushort value)
   {
      if(value>=48 && value<=57) return (int)value-48;
      if(value>=97 && value<=102) return (int)value-87;
      if(value>=65 && value<=70) return (int)value-55;
      return 0;
   }

   uchar HexByte(const string value,const int index)
   {
      int high=Nibble((ushort)StringGetCharacter(value,index*2));
      int low=Nibble((ushort)StringGetCharacter(value,index*2+1));
      return (uchar)(high*16+low);
   }

   int HandleSlot(const int handle)
   {
      int slot=handle-1000;
      if(slot<0 || slot>=ArraySize(m_handle_open) || !m_handle_open[slot]) return -1;
      return slot;
   }

   int SearchSlot(const long handle)
   {
      int slot=(int)handle-2000;
      if(slot<0 || slot>=ArraySize(m_search_open) || !m_search_open[slot]) return -1;
      return slot;
   }

   bool NextChild(const string parent,int &cursor,string &name)
   {
      for(int i=cursor+1;i<ArraySize(m_path);i++)
      {
         if(!m_active[i] || ParentOf(m_path[i])!=parent) continue;
         cursor=i;
         name=NameOf(m_path[i]);
         return true;
      }
      return false;
   }

public:
   CTov2DeterministicFileOps() { ResetFake(); }

   void ResetFake()
   {
      ArrayResize(m_path,0); ArrayResize(m_directory,0); ArrayResize(m_active,0);
      ArrayResize(m_size,0); ArrayResize(m_hex,0);
      ArrayResize(m_handle_node,64); ArrayResize(m_handle_position,64);
      ArrayResize(m_handle_open,64); ArrayInitialize(m_handle_open,false);
      ArrayResize(m_search_parent,16); ArrayResize(m_search_cursor,16);
      ArrayResize(m_search_open,16); ArrayInitialize(m_search_open,false);
      m_external_owner=false;
      m_open_fault=-1; m_read_fault=-1; m_write_fault=-1;
      m_flush_fault=-1; m_close_fault=-1; m_find_next_fault=-1;
      m_find_close_fault=-1; m_resize_bytes_fault=-1;
      m_resize_entries_fault=-1; m_copy_fault=-1; m_hash_fault=-1;
      m_path_fault=-1;
      m_short_read=false; m_short_write=false;
      m_native_exhaustion_error=false;
      m_opened_files=0; m_closed_files=0;
      m_opened_searches=0; m_closed_searches=0;
   }

   void SeedDirectory(const string path)
   {
      if(Node(path)<0) AddNode(path,true,0,"");
   }

   void SeedFile(const string path,const uchar &bytes[])
   {
      int node=Node(path);
      if(node<0) node=AddNode(path,false,ArraySize(bytes),BytesHex(bytes,ArraySize(bytes)));
      else
      {
         m_directory[node]=false; m_size[node]=ArraySize(bytes);
         m_hex[node]=BytesHex(bytes,ArraySize(bytes));
      }
   }

   void SeedSizedFile(const string path,const long size)
   {
      int node=Node(path);
      if(node<0) AddNode(path,false,size,"");
      else { m_directory[node]=false; m_size[node]=size; m_hex[node]=""; }
   }

   void SeedDuplicateFile(const string path,const uchar &bytes[])
   {
      AddNode(path,false,ArraySize(bytes),BytesHex(bytes,ArraySize(bytes)));
   }

   void SeedBusyOwner()
   {
      uchar empty[];
      SeedFile(NativeRoot()+TOV2_FILE_STORE_SEPARATOR+TOV2_FILE_STORE_OWNER_NAME,empty);
      m_external_owner=true;
   }

   void SeedCleanAcquiredLayout()
   {
      SeedDirectory(NativeRoot());
      SeedDirectory(NativeRoot()+"\\objects");
      SeedDirectory(NativeRoot()+"\\states");
      SeedDirectory(NativeRoot()+"\\commits");
   }

   void ForceMissingPath(const string path)
   {
      int node=Node(path);
      if(node>=0) m_active[node]=false;
   }

   void ForceOwnerNonzero()
   {
      int node=Node(NativeRoot()+"\\owner.lock");
      if(node>=0) m_size[node]=1;
   }

   void ForceOwnerHandleDead()
   {
      for(int i=0;i<ArraySize(m_handle_open);i++) m_handle_open[i]=false;
   }

   void ArmOpenFault(const int after=0) { m_open_fault=after; }
   void ArmReadFault(const int after=0) { m_read_fault=after; }
   void ArmWriteFault(const int after=0) { m_write_fault=after; }
   void ArmFlushFault(const int after=0) { m_flush_fault=after; }
   void ArmCloseFault(const int after=0) { m_close_fault=after; }
   void ArmFindNextFault(const int after=0) { m_find_next_fault=after; }
   void ArmFindCloseFault(const int after=0) { m_find_close_fault=after; }
   void ArmResizeBytesFault(const int after=0) { m_resize_bytes_fault=after; }
   void ArmResizeEntriesFault(const int after=0) { m_resize_entries_fault=after; }
   void ArmCopyFault(const int after=0) { m_copy_fault=after; }
   void ArmHashFault(const int after=0) { m_hash_fault=after; }
   void ArmPathFault(const int after=0) { m_path_fault=after; }
   void SetShortRead() { m_short_read=true; }
   void SetShortWrite() { m_short_write=true; }
   void UseNativeExhaustionError() { m_native_exhaustion_error=true; }
   int OpenHandleCount() { return m_opened_files-m_closed_files; }
   int OpenSearchCount() { return m_opened_searches-m_closed_searches; }

   bool FolderCreateCommon(const string path,int &native_error)
   {
      native_error=0;
      int node=Node(path);
      if(node>=0) return false;
      return AddNode(path,true,0,"")>=0;
   }

   long FindFirstCommon(const string filter,string &name,int &native_error)
   {
      native_error=0;
      string suffix="\\*";
      if(StringLen(filter)<2 || StringSubstr(filter,StringLen(filter)-2)!=suffix)
      { native_error=1; return INVALID_HANDLE; }
      string parent=StringSubstr(filter,0,StringLen(filter)-2);
      int parent_node=Node(parent);
      if(parent_node<0 || !m_directory[parent_node])
      { native_error=ERR_DIRECTORY_NOT_EXIST; return INVALID_HANDLE; }
      int cursor=-1;
      if(!NextChild(parent,cursor,name)) return INVALID_HANDLE;
      for(int slot=0;slot<ArraySize(m_search_open);slot++)
      {
         if(m_search_open[slot]) continue;
         m_search_open[slot]=true; m_search_parent[slot]=parent;
         m_search_cursor[slot]=cursor; m_opened_searches++;
         return 2000+slot;
      }
      native_error=1;
      return INVALID_HANDLE;
   }

   bool FindNext(const long search_handle,string &name,int &native_error)
   {
      native_error=0;
      if(FaultNow(m_find_next_fault)) { native_error=1; return false; }
      int slot=SearchSlot(search_handle);
      if(slot<0) { native_error=1; return false; }
      int cursor=m_search_cursor[slot];
      bool found=NextChild(m_search_parent[slot],cursor,name);
      m_search_cursor[slot]=cursor;
      if(!found && m_native_exhaustion_error) native_error=ERR_FILE_NOT_EXIST;
      return found;
   }

   bool FindClose(const long search_handle,int &native_error)
   {
      native_error=0;
      int slot=SearchSlot(search_handle);
      if(slot<0) { native_error=1; return false; }
      m_search_open[slot]=false; m_closed_searches++;
      if(FaultNow(m_find_close_fault)) { native_error=1; return false; }
      return true;
   }

   long PathIntegerCommon(const string path,const ENUM_FILE_PROPERTY_INTEGER property,
                          int &native_error)
   {
      native_error=0;
      if(FaultNow(m_path_fault)) { native_error=1; return -1; }
      int node=Node(path);
      if(node<0) { native_error=ERR_FILE_NOT_EXIST; return -1; }
      if(m_directory[node])
      {
         native_error=ERR_FILE_IS_DIRECTORY;
         return property==FILE_EXISTS ? 1 : 0;
      }
      if(property==FILE_EXISTS) return 1;
      if(property==FILE_SIZE) return m_size[node];
      native_error=1;
      return -1;
   }

   int OpenCommon(const string path,const int flags,int &native_error)
   {
      native_error=0;
      if(FaultNow(m_open_fault)) { native_error=1; return INVALID_HANDLE; }
      if(m_external_owner && path==NativeRoot()+"\\owner.lock")
      { native_error=ERR_CANNOT_OPEN_FILE; return INVALID_HANDLE; }
      int node=Node(path);
      bool writable=(flags&FILE_WRITE)!=0;
      if(node<0 && writable) node=AddNode(path,false,0,"");
      if(node<0 || m_directory[node]) { native_error=1; return INVALID_HANDLE; }
      for(int i=0;i<ArraySize(m_handle_open);i++)
         if(m_handle_open[i] && m_handle_node[i]==node)
         { native_error=ERR_CANNOT_OPEN_FILE; return INVALID_HANDLE; }
      for(int slot=0;slot<ArraySize(m_handle_open);slot++)
      {
         if(m_handle_open[slot]) continue;
         m_handle_open[slot]=true; m_handle_node[slot]=node;
         m_handle_position[slot]=0; m_opened_files++;
         return 1000+slot;
      }
      native_error=1;
      return INVALID_HANDLE;
   }

   long HandleInteger(const int handle,const ENUM_FILE_PROPERTY_INTEGER property,
                      int &native_error)
   {
      native_error=0;
      int slot=HandleSlot(handle);
      if(slot<0) { native_error=1; return 0; }
      if(property==FILE_SIZE) return m_size[m_handle_node[slot]];
      if(property==FILE_POSITION) return m_handle_position[slot];
      native_error=1;
      return 0;
   }

   uint ReadBytes(const int handle,uchar &bytes[],const int start,const int count,
                  int &native_error)
   {
      native_error=0;
      if(FaultNow(m_read_fault)) { native_error=1; return 0; }
      int slot=HandleSlot(handle);
      if(slot<0) { native_error=1; return 0; }
      int node=m_handle_node[slot];
      int actual=count;
      if(m_short_read && actual>0) { actual--; m_short_read=false; }
      for(int i=0;i<actual;i++) bytes[start+i]=HexByte(m_hex[node],i);
      m_handle_position[slot]+=actual;
      return (uint)actual;
   }

   uint WriteBytes(const int handle,const uchar &bytes[],const int start,const int count,
                   int &native_error)
   {
      native_error=0;
      if(FaultNow(m_write_fault)) { native_error=1; return 0; }
      int slot=HandleSlot(handle);
      if(slot<0) { native_error=1; return 0; }
      int actual=count;
      if(m_short_write && actual>0) { actual--; m_short_write=false; }
      uchar staged[];
      if(ArrayResize(staged,actual)!=actual) { native_error=1; return 0; }
      for(int i=0;i<actual;i++) staged[i]=bytes[start+i];
      int node=m_handle_node[slot];
      m_hex[node]=BytesHex(staged,actual); m_size[node]=actual;
      m_handle_position[slot]=actual;
      return (uint)actual;
   }

   bool Flush(const int handle,int &native_error)
   {
      native_error=0;
      if(HandleSlot(handle)<0) { native_error=1; return false; }
      if(FaultNow(m_flush_fault)) { native_error=1; return false; }
      return true;
   }

   bool CloseFile(const int handle,int &native_error)
   {
      native_error=0;
      int slot=HandleSlot(handle);
      if(slot<0) { native_error=1; return false; }
      m_handle_open[slot]=false; m_closed_files++;
      if(FaultNow(m_close_fault)) { native_error=1; return false; }
      return true;
   }

   bool DeleteFileCommon(const string path,int &native_error)
   {
      native_error=0;
      int node=Node(path);
      if(node<0 || m_directory[node]) { native_error=1; return false; }
      m_active[node]=false;
      return true;
   }

   int ResizeBytes(uchar &bytes[],const int count,int &native_error)
   {
      native_error=0;
      if(FaultNow(m_resize_bytes_fault)) { native_error=1; return -1; }
      return ArrayResize(bytes,count);
   }

   int CopyBytes(uchar &destination[],const uchar &source[],const int destination_start,
                 const int source_start,const int count,int &native_error)
   {
      native_error=0;
      if(FaultNow(m_copy_fault)) { native_error=1; return -1; }
      return ArrayCopy(destination,source,destination_start,source_start,count);
   }

   int ResizeEntries(Tov2StorageEntry &entries[],const int count,int &native_error)
   {
      native_error=0;
      if(FaultNow(m_resize_entries_fault)) { native_error=1; return -1; }
      return ArrayResize(entries,count);
   }

   bool HashBytes(const uchar &bytes[],string &sha,int &native_error)
   {
      native_error=0;
      sha="";
      if(FaultNow(m_hash_fault)) { native_error=1; return false; }
      return Tov2LocalHash(bytes,sha);
   }
};

int ObserveOpenFiles(CTov2DeterministicFileOps &fake_ops)
{
   return fake_ops.OpenHandleCount();
}

int ObserveOpenSearches(CTov2DeterministicFileOps &fake_ops)
{
   return fake_ops.OpenSearchCount();
}

void CheckOwnerOnlyHandle(CTov2DeterministicFileOps &ops,const string label)
{
   int count=ops.OpenHandleCount();
   Check(count==1,label);
}

void CheckNoSearchHandle(CTov2DeterministicFileOps &ops,const string label)
{
   int count=ops.OpenSearchCount();
   Check(count==0,label);
}

void CheckFakeQuiescent(CTov2DeterministicFileOps &ops,const string label)
{
   CheckOwnerOnlyHandle(ops,label+".file");
   CheckNoSearchHandle(ops,label+".search");
}

void FakeStaleError()
{
   CTov2TelemetryMqlFileOps production_ops;
   uchar empty[]; int native_error=-1;
   SetUserError(913);
   int stale_before=GetLastError();
   int result=production_ops.ResizeBytes(empty,0,native_error);
   Check(stale_before!=0,"error.stale.precondition");
   Check(result==0,"error.stale_isolated");
   Check(native_error==0,"error.stale.native_error_zero");
   ResetLastError();
}

void FakeAllocationRead()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(101,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageLocator locator=Tov2StorageObjectLocator(101,1);
   ops.SeedFile(NativePath(locator),frame); ops.ArmResizeBytesFault(1);
   uchar output[]; int result=store.Read(token,locator,output);
   Check(result==TOV2_STORE_IO_ERROR,"allocation.read");
   CheckFakeQuiescent(ops,"allocation.read.closed"); store.Close(token);
}

void FakeAllocationInventory()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   ops.ArmResizeEntriesFault(1); Tov2StorageEntry entries[];
   int result=store.Inventory(token,entries);
   Check(result==TOV2_STORE_IO_ERROR,"allocation.inventory");
   CheckFakeQuiescent(ops,"allocation.inventory.closed"); store.Close(token);
}

void FakeCopyRead()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(102,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageLocator locator=Tov2StorageObjectLocator(102,1);
   ops.SeedFile(NativePath(locator),frame); ops.ArmCopyFault();
   uchar output[]; int result=store.Read(token,locator,output);
   Check(result==TOV2_STORE_IO_ERROR,"copy.read");
   CheckFakeQuiescent(ops,"copy.read.closed"); store.Close(token);
}

void FakeCopyInventory()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(103,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token);
   ops.SeedFile(NativePath(Tov2StorageObjectLocator(103,1)),frame);
   ops.ArmCopyFault(); Tov2StorageEntry entries[];
   int result=store.Inventory(token,entries);
   Check(result==TOV2_STORE_IO_ERROR,"copy.inventory");
   CheckFakeQuiescent(ops,"copy.inventory.closed"); store.Close(token);
}

void FakeHashRead()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(104,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token); ops.ArmHashFault();
   Tov2StorageLocator locator=Tov2StorageObjectLocator(104,1);
   int result=store.CreateExact(token,locator,frame);
   Check(result==TOV2_STORE_IO_ERROR,"hash.read");
   CheckFakeQuiescent(ops,"hash.read.closed"); store.Close(token);
}

void FakeHashInventory()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(105,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token);
   ops.SeedFile(NativePath(Tov2StorageObjectLocator(105,1)),frame);
   ops.ArmHashFault(); Tov2StorageEntry entries[];
   int result=store.Inventory(token,entries);
   Check(result==TOV2_STORE_IO_ERROR,"hash.inventory");
   CheckFakeQuiescent(ops,"hash.inventory.closed"); store.Close(token);
}

void FakeReadShort()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(106,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageLocator locator=Tov2StorageObjectLocator(106,1);
   ops.SeedFile(NativePath(locator),frame); ops.SetShortRead();
   uchar output[]; int result=store.Read(token,locator,output);
   int output_count=ArraySize(output);
   Check(result==TOV2_STORE_IO_ERROR && output_count==0,"read.short");
   CheckFakeQuiescent(ops,"read.short.closed"); store.Close(token);
}

void FakeReadZero()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageLocator locator=Tov2StorageObjectLocator(107,1);
   ops.SeedSizedFile(NativePath(locator),0); uchar output[]; ArrayResize(output,2);
   int result=store.Read(token,locator,output);
   int output_count=ArraySize(output);
   Check(result==TOV2_STORE_CONFLICT && output_count==0,"read.zero_length_conflict");
   CheckFakeQuiescent(ops,"read.zero.closed"); store.Close(token);
}

void FakeReadOversized()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageLocator locator=Tov2StorageObjectLocator(108,1);
   ops.SeedSizedFile(NativePath(locator),TOV2_RECORD_FRAME_MAX+1); uchar output[]; ArrayResize(output,2);
   int result=store.Read(token,locator,output);
   int output_count=ArraySize(output);
   Check(result==TOV2_STORE_LIMIT && output_count==0,"read.oversized_limit");
   CheckFakeQuiescent(ops,"read.oversized.closed"); store.Close(token);
}

void FakeWriteShort()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(109,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token); ops.SetShortWrite();
   Tov2StorageLocator locator=Tov2StorageObjectLocator(109,1);
   int result=store.CreateExact(token,locator,frame);
   Check(result==TOV2_STORE_IO_ERROR,"write.short");
   CheckFakeQuiescent(ops,"write.short.closed"); store.Close(token);
}

void FakeFlushError()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(110,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token); ops.ArmFlushFault();
   Tov2StorageLocator locator=Tov2StorageObjectLocator(110,1);
   int result=store.CreateExact(token,locator,frame);
   Check(result==TOV2_STORE_IO_ERROR,"flush.error");
   CheckFakeQuiescent(ops,"flush.error.closed"); store.Close(token);
}

void FakeCloseError()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(111,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageLocator locator=Tov2StorageObjectLocator(111,1);
   ops.SeedFile(NativePath(locator),frame); ops.ArmCloseFault();
   uchar output[]; int result=store.Read(token,locator,output);
   Check(result==TOV2_STORE_IO_ERROR,"close.error");
   CheckFakeQuiescent(ops,"close.error.closed"); store.Close(token);
}

void FakeOpenError()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(112,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageLocator locator=Tov2StorageObjectLocator(112,1);
   ops.SeedFile(NativePath(locator),frame); ops.ArmOpenFault();
   uchar output[]; int result=store.Read(token,locator,output);
   Check(result==TOV2_STORE_IO_ERROR,"open.error");
   CheckFakeQuiescent(ops,"open.error.closed"); store.Close(token);
}

void FakeReopenError()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(113,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token); ops.ArmOpenFault(1);
   Tov2StorageLocator locator=Tov2StorageObjectLocator(113,1);
   int result=store.CreateExact(token,locator,frame);
   Check(result==TOV2_STORE_IO_ERROR,"reopen.error");
   CheckFakeQuiescent(ops,"reopen.error.closed"); store.Close(token);
}

void FakeEnumerationExhaustion()
{
   CTov2DeterministicFileOps fake_ops; CTov2TelemetryFileStore store(GetPointer(fake_ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   fake_ops.UseNativeExhaustionError();
   Tov2StorageEntry entries[]; int result=store.Inventory(token,entries);
   int search_count=fake_ops.OpenSearchCount();
   Check(result==TOV2_STORE_OK && search_count==0,"enumeration.exhaustion"); store.Close(token);
}

void FakeEnumerationNextError()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   ops.ArmFindNextFault(); Tov2StorageEntry entries[];
   int result=store.Inventory(token,entries);
   Check(result==TOV2_STORE_IO_ERROR,"enumeration.next_error");
   CheckFakeQuiescent(ops,"enumeration.next_error.closed"); store.Close(token);
}

void FakeShortHandlesClosed()
{
   CTov2DeterministicFileOps fake_ops; uchar frame[]; MakeFrame(114,1,frame);
   CTov2TelemetryFileStore store(GetPointer(fake_ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageLocator locator=Tov2StorageObjectLocator(114,1);
   fake_ops.SeedFile(NativePath(locator),frame); fake_ops.ArmReadFault();
   uchar output[]; int result=store.Read(token,locator,output);
   int open_count=fake_ops.OpenHandleCount();
   Check(result==TOV2_STORE_IO_ERROR && open_count==1,"handles.short_lived_closed");
   store.Close(token);
}

void FakeEnumerationHandlesClosed()
{
   CTov2DeterministicFileOps fake_ops; CTov2TelemetryFileStore store(GetPointer(fake_ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   fake_ops.ArmFindCloseFault();
   Tov2StorageEntry entries[]; int result=store.Inventory(token,entries);
   int search_count=fake_ops.OpenSearchCount();
   int open_count=fake_ops.OpenHandleCount();
   Check(result==TOV2_STORE_IO_ERROR && search_count==0 && open_count==1,
         "handles.enumeration_closed");
   store.Close(token);
}

void FakeOwnerNonzero()
{
   CTov2DeterministicFileOps ops; ops.SeedDirectory(NativeRoot());
   ops.SeedSizedFile(NativeRoot()+"\\owner.lock",1);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   int result=store.Acquire(TOV2_NATIVE_KEY,token);
   Check(result==TOV2_STORE_CONFLICT,"owner.nonzero");
}

void FakeOwnerUnreadable()
{
   CTov2DeterministicFileOps ops; ops.SeedDirectory(NativeRoot());
   ops.SeedSizedFile(NativeRoot()+"\\owner.lock",0); ops.ArmPathFault(1);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   int result=store.Acquire(TOV2_NATIVE_KEY,token);
   Check(result==TOV2_STORE_IO_ERROR,"owner.unreadable");
}

void FakeOwnerBusy()
{
   CTov2DeterministicFileOps ops; ops.SeedDirectory(NativeRoot()); ops.SeedBusyOwner();
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   int result=store.Acquire(TOV2_NATIVE_KEY,token);
   Check(result==TOV2_STORE_BUSY,"owner.busy");
}

void FakeSessionEmpty()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   int result=store.Revalidate("");
   Check(result==TOV2_STORE_OWNERSHIP_LOST,"session.empty"); store.Close(token);
}

void FakeSessionStale()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token); store.Close(token);
   int result=store.Revalidate(token);
   Check(result==TOV2_STORE_OWNERSHIP_LOST,"session.stale");
}

void FakeSessionMismatched()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   string other=token+".other"; int result=store.Revalidate(other);
   Check(result==TOV2_STORE_OWNERSHIP_LOST,"session.mismatched"); store.Close(token);
}

void FakeSessionDeadHandle()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token); ops.ForceOwnerHandleDead();
   int result=store.Revalidate(token);
   Check(result==TOV2_STORE_OWNERSHIP_LOST,"session.dead_handle");
}

void FakeSessionNonzeroLock()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token); ops.ForceOwnerNonzero();
   int result=store.Revalidate(token);
   Check(result==TOV2_STORE_OWNERSHIP_LOST,"session.nonzero_lock");
}

void FakeMissingContainer()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   ops.ForceMissingPath(NativeRoot()+"\\objects"); Tov2StorageEntry entries[]; ArrayResize(entries,1);
   int result=store.Inventory(token,entries);
   int output_count=ArraySize(entries);
   Check(result==TOV2_STORE_CONFLICT && output_count==0,"containers.missing_after_acquire_conflict");
   CheckFakeQuiescent(ops,"containers.missing.closed");
   store.Close(token);
}

void FakeReadMissingContainer()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   ops.ForceMissingPath(NativeRoot()+"\\objects");
   Tov2StorageLocator locator=Tov2StorageObjectLocator(301,1);
   uchar output[]; ArrayResize(output,2); output[0]=7; output[1]=9;
   int input_count=ArraySize(output);
   int result=store.Read(token,locator,output);
   int output_count=ArraySize(output);
   int open_count=ops.OpenHandleCount();
   int search_count=ops.OpenSearchCount();
   Check(result==TOV2_STORE_CONFLICT,"read.missing_container_conflict");
   Check(input_count>0 && output_count==0,"read.missing_container.output_cleared");
   Check(open_count==1 && search_count==0,"read.missing_container.no_leak");
   CheckFakeQuiescent(ops,"read.missing_container.closed"); store.Close(token);
}

void FakeCreateMissingContainer()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   uchar frame[]; MakeFrame(302,1,frame);
   ops.ForceMissingPath(NativeRoot()+"\\objects");
   Tov2StorageLocator locator=Tov2StorageObjectLocator(302,1);
   int result=store.CreateExact(token,locator,frame);
   int open_count=ops.OpenHandleCount();
   int search_count=ops.OpenSearchCount();
   Check(result==TOV2_STORE_CONFLICT,"create.missing_container_conflict");
   Check(open_count==1 && search_count==0,"create.missing_container.no_leak");
   CheckFakeQuiescent(ops,"create.missing_container.closed"); store.Close(token);
}

void FakeDeleteMissingContainer()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   ops.ForceMissingPath(NativeRoot()+"\\objects");
   Tov2StorageLocator locator=Tov2StorageObjectLocator(303,1);
   int result=store.DeleteExact(token,locator,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
   int open_count=ops.OpenHandleCount();
   int search_count=ops.OpenSearchCount();
   Check(result==TOV2_STORE_CONFLICT,"delete.missing_container_conflict");
   Check(open_count==1 && search_count==0,"delete.missing_container.no_leak");
   CheckFakeQuiescent(ops,"delete.missing_container.closed"); store.Close(token);
}

void FakeUnexpectedDirectory()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   ops.SeedDirectory(NativeRoot()+"\\unexpected"); Tov2StorageEntry entries[]; ArrayResize(entries,1);
   int result=store.Inventory(token,entries);
   int output_count=ArraySize(entries);
   Check(result==TOV2_STORE_CONFLICT && output_count==0,"inventory.unexpected_directory");
   CheckFakeQuiescent(ops,"inventory.unexpected.closed"); store.Close(token);
}

void FakeDirectoryAtRecord()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   ops.SeedDirectory(NativePath(Tov2StorageObjectLocator(201,1)));
   Tov2StorageEntry entries[]; ArrayResize(entries,1); int result=store.Inventory(token,entries);
   int output_count=ArraySize(entries);
   Check(result==TOV2_STORE_CONFLICT && output_count==0,"inventory.directory_at_record");
   CheckFakeQuiescent(ops,"inventory.directory.closed"); store.Close(token);
}

void FakeAbsenceProven()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageEntry entries[]; int result=store.Inventory(token,entries);
   int count=ArraySize(entries);
   Check(result==TOV2_STORE_OK && count==1,"inventory.absence_proven"); store.Close(token);
}

void FakeUnknownName()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token); uchar bytes[];
   ArrayResize(bytes,1); bytes[0]=1; ops.SeedFile(NativeRoot()+"\\unknown.bin",bytes);
   Tov2StorageEntry entries[]; ArrayResize(entries,1); int result=store.Inventory(token,entries);
   int output_count=ArraySize(entries);
   Check(result==TOV2_STORE_CONFLICT && output_count==0,"inventory.unknown_name");
   CheckFakeQuiescent(ops,"inventory.unknown.closed"); store.Close(token);
}

void FakeMalformedName()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token); uchar bytes[];
   ArrayResize(bytes,1); bytes[0]=1;
   ops.SeedFile(NativeRoot()+"\\objects\\00203-1.rec",bytes);
   Tov2StorageEntry entries[]; ArrayResize(entries,1); int result=store.Inventory(token,entries);
   int output_count=ArraySize(entries);
   Check(result==TOV2_STORE_CONFLICT && output_count==0,"inventory.malformed_name");
   CheckFakeQuiescent(ops,"inventory.malformed.closed"); store.Close(token);
}

void FakeDuplicateName()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(204,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token); string path=NativePath(Tov2StorageObjectLocator(204,1));
   ops.SeedFile(path,frame); ops.SeedDuplicateFile(path,frame);
   Tov2StorageEntry entries[]; ArrayResize(entries,1); int result=store.Inventory(token,entries);
   int output_count=ArraySize(entries);
   Check(result==TOV2_STORE_CONFLICT && output_count==0,"inventory.duplicate");
   CheckFakeQuiescent(ops,"inventory.duplicate.closed"); store.Close(token);
}

void FakeCaseCollision()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(205,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token);
   ops.SeedFile(NativeRoot()+"\\objects\\205-1.rec",frame);
   ops.SeedFile(NativeRoot()+"\\objects\\205-1.REC",frame);
   Tov2StorageEntry entries[]; ArrayResize(entries,1); int result=store.Inventory(token,entries);
   int output_count=ArraySize(entries);
   Check(result==TOV2_STORE_CONFLICT && output_count==0,"inventory.case_collision");
   CheckFakeQuiescent(ops,"inventory.case.closed"); store.Close(token);
}

void FakeInventoryZero()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   ops.SeedSizedFile(NativePath(Tov2StorageObjectLocator(206,1)),0);
   Tov2StorageEntry entries[]; ArrayResize(entries,1); int result=store.Inventory(token,entries);
   int output_count=ArraySize(entries);
   Check(result==TOV2_STORE_CONFLICT && output_count==0,"inventory.zero_length");
   CheckFakeQuiescent(ops,"inventory.zero.closed"); store.Close(token);
}

void FakeInventoryOversized()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   ops.SeedSizedFile(NativePath(Tov2StorageObjectLocator(207,1)),TOV2_RECORD_FRAME_MAX+1);
   Tov2StorageEntry entries[]; ArrayResize(entries,1); int result=store.Inventory(token,entries);
   int output_count=ArraySize(entries);
   Check(result==TOV2_STORE_LIMIT && output_count==0,"inventory.oversized");
   CheckFakeQuiescent(ops,"inventory.oversized.closed"); store.Close(token);
}

void FakeInventory4225()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(208,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token);
   for(int i=1;i<=4224;i++)
      ops.SeedFile(NativePath(Tov2StorageObjectLocator(208,i)),frame);
   Tov2StorageEntry entries[]; int result=store.Inventory(token,entries);
   int count=ArraySize(entries);
   Check(result==TOV2_STORE_OK && count==4225,"inventory.4225"); store.Close(token);
}

void FakeInventory4226()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(209,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token);
   for(int i=1;i<=4225;i++)
      ops.SeedFile(NativePath(Tov2StorageObjectLocator(209,i)),frame);
   Tov2StorageEntry entries[]; ArrayResize(entries,1); int result=store.Inventory(token,entries);
   int output_count=ArraySize(entries);
   Check(result==TOV2_STORE_LIMIT && output_count==0,"inventory.4226_refused");
   CheckFakeQuiescent(ops,"inventory.4226.closed"); store.Close(token);
}

void FakeCreateExistingSame()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(301,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token); Tov2StorageLocator locator=Tov2StorageObjectLocator(301,1);
   ops.SeedFile(NativePath(locator),frame);
   int result=store.CreateExact(token,locator,frame);
   Check(result==TOV2_STORE_EXISTS_SAME,"create.existing_same");
   CheckFakeQuiescent(ops,"create.same.closed"); store.Close(token);
}

void FakeCreateDiffering()
{
   CTov2DeterministicFileOps ops; uchar first[]; uchar second[];
   MakeFrame(302,1,first); MakeFrame(302,2,second);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token); Tov2StorageLocator locator=Tov2StorageObjectLocator(302,1);
   ops.SeedFile(NativePath(locator),first);
   int result=store.CreateExact(token,locator,second);
   Check(result==TOV2_STORE_CONFLICT,"create.differing");
   CheckFakeQuiescent(ops,"create.differing.closed"); store.Close(token);
}

void FakeCreatePartial()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(303,1,frame);
   uchar partial[]; int count=ArraySize(frame)-1; ArrayResize(partial,count);
   ArrayCopy(partial,frame,0,0,count);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token); Tov2StorageLocator locator=Tov2StorageObjectLocator(303,1);
   ops.SeedFile(NativePath(locator),partial);
   int result=store.CreateExact(token,locator,frame);
   Check(result==TOV2_STORE_CONFLICT,"create.partial");
   CheckFakeQuiescent(ops,"create.partial.closed"); store.Close(token);
}

void FakeCreateDirectoryConflict()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(304,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token); Tov2StorageLocator locator=Tov2StorageObjectLocator(304,1);
   ops.SeedDirectory(NativePath(locator));
   int result=store.CreateExact(token,locator,frame);
   Check(result==TOV2_STORE_CONFLICT,"create.directory_conflict");
   CheckFakeQuiescent(ops,"create.directory.closed"); store.Close(token);
}

void FakeCreateZeroConflict()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(305,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token); Tov2StorageLocator locator=Tov2StorageObjectLocator(305,1);
   ops.SeedSizedFile(NativePath(locator),0);
   int result=store.CreateExact(token,locator,frame);
   Check(result==TOV2_STORE_CONFLICT,"create.zero_length_conflict");
   CheckFakeQuiescent(ops,"create.zero.closed"); store.Close(token);
}

void FakeCreateOversizedConflict()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(306,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token); Tov2StorageLocator locator=Tov2StorageObjectLocator(306,1);
   ops.SeedSizedFile(NativePath(locator),TOV2_RECORD_FRAME_MAX+1);
   int result=store.CreateExact(token,locator,frame);
   Check(result==TOV2_STORE_CONFLICT,"create.oversized_conflict");
   CheckFakeQuiescent(ops,"create.oversized.closed"); store.Close(token);
}

void FakeDeleteAbsent()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageLocator locator=Tov2StorageObjectLocator(401,1);
   int result=store.DeleteExact(token,locator,
                                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
   Check(result==TOV2_STORE_ABSENT,"delete.absent");
   CheckFakeQuiescent(ops,"delete.absent.closed"); store.Close(token);
}

void FakeDeleteZeroConflict()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageLocator locator=Tov2StorageObjectLocator(402,1);
   ops.SeedSizedFile(NativePath(locator),0);
   int result=store.DeleteExact(token,locator,
                                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
   Check(result==TOV2_STORE_CONFLICT,"delete.zero_length_conflict");
   CheckFakeQuiescent(ops,"delete.zero.closed"); store.Close(token);
}

void FakeDeleteOversized()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageLocator locator=Tov2StorageObjectLocator(403,1);
   ops.SeedSizedFile(NativePath(locator),TOV2_RECORD_FRAME_MAX+1);
   int result=store.DeleteExact(token,locator,
                                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
   Check(result==TOV2_STORE_LIMIT,"delete.oversized_limit");
   CheckFakeQuiescent(ops,"delete.oversized.closed"); store.Close(token);
}

void FakeDeleteDigestConflict()
{
   CTov2DeterministicFileOps ops; uchar frame[]; MakeFrame(404,1,frame);
   CTov2TelemetryFileStore store(GetPointer(ops)); string token="";
   store.Acquire(TOV2_NATIVE_KEY,token); Tov2StorageLocator locator=Tov2StorageObjectLocator(404,1);
   ops.SeedFile(NativePath(locator),frame);
   int result=store.DeleteExact(token,locator,
                                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
   Check(result==TOV2_STORE_CONFLICT,"delete.digest_conflict");
   CheckFakeQuiescent(ops,"delete.digest.closed"); store.Close(token);
}

void FakeDeleteOwnerRefused()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageLocator locator=Tov2StorageOwnerLocator();
   int result=store.DeleteExact(token,locator,
                                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
   Check(result==TOV2_STORE_INVALID,"delete.owner_refused");
   CheckFakeQuiescent(ops,"delete.owner.closed"); store.Close(token);
}

void FakeDeleteRegistrationRefused()
{
   CTov2DeterministicFileOps ops; CTov2TelemetryFileStore store(GetPointer(ops));
   string token=""; store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageLocator locator=Tov2StorageRegistrationLocator();
   int result=store.DeleteExact(token,locator,
                                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
   Check(result==TOV2_STORE_INVALID,"delete.registration_refused");
   CheckFakeQuiescent(ops,"delete.registration.closed"); store.Close(token);
}

void RunDeterministicFakeSuite()
{
   FakeStaleError();
   FakeAllocationRead(); FakeAllocationInventory();
   FakeCopyRead(); FakeCopyInventory(); FakeHashRead(); FakeHashInventory();
   FakeReadShort(); FakeReadZero(); FakeReadOversized();
   FakeWriteShort(); FakeFlushError(); FakeCloseError();
   FakeOpenError(); FakeReopenError();
   FakeEnumerationExhaustion(); FakeEnumerationNextError();
   FakeShortHandlesClosed(); FakeEnumerationHandlesClosed();
   FakeOwnerNonzero(); FakeOwnerUnreadable(); FakeOwnerBusy();
   FakeSessionEmpty(); FakeSessionStale(); FakeSessionMismatched();
   FakeSessionDeadHandle(); FakeSessionNonzeroLock(); FakeMissingContainer();
   FakeReadMissingContainer(); FakeCreateMissingContainer(); FakeDeleteMissingContainer();
   FakeUnexpectedDirectory(); FakeDirectoryAtRecord(); FakeAbsenceProven();
   FakeUnknownName(); FakeMalformedName(); FakeDuplicateName(); FakeCaseCollision();
   FakeInventoryZero(); FakeInventoryOversized();
   FakeInventory4225(); FakeInventory4226();
   FakeCreateExistingSame(); FakeCreateDiffering(); FakeCreatePartial();
   FakeCreateDirectoryConflict(); FakeCreateZeroConflict(); FakeCreateOversizedConflict();
   FakeDeleteAbsent(); FakeDeleteZeroConflict(); FakeDeleteOversized();
   FakeDeleteDigestConflict(); FakeDeleteOwnerRefused(); FakeDeleteRegistrationRefused();
}

bool ExactInventory(const Tov2StorageEntry &entries[],const int allowed_kind,
                    const long allowed_generation,const long allowed_ordinal)
{
   Tov2StorageLocator owner=Tov2StorageOwnerLocator();
   Tov2StorageLocator allowed;
   allowed.kind=allowed_kind;
   allowed.generation=allowed_generation;
   allowed.ordinal=allowed_ordinal;
   if(allowed_kind==0)
      return ArraySize(entries)==1 &&
             Tov2StorageSameLocator(entries[0].locator,owner) &&
             entries[0].size==0 && entries[0].sha=="-";
   return ArraySize(entries)==2 &&
          Tov2StorageSameLocator(entries[0].locator,owner) &&
          entries[0].size==0 && entries[0].sha=="-" &&
          Tov2StorageSameLocator(entries[1].locator,allowed) &&
          entries[1].size>=1 && Tov2Digest(entries[1].sha);
}

bool InventoryDigest(const Tov2StorageEntry &entries[],string &digest)
{
   string canonical="";
   for(int i=0;i<ArraySize(entries);i++)
      canonical+=entries[i].relative_path+"|"+Tov2LocalNumber(entries[i].size)+
                 "|"+entries[i].sha+"\n";
   uchar bytes[];
   return Tov2LocalBytes(canonical,bytes) && Tov2LocalHash(bytes,digest);
}

int ObservedEntryCount(const Tov2StorageEntry &entries[])
{
   return ArraySize(entries);
}

int ObservedByteCount(const uchar &bytes[])
{
   return ArraySize(bytes);
}

void PrintCommonPath()
{
   string common=TerminalInfoString(TERMINAL_COMMONDATA_PATH);
   Print("TOV2_FILE_STORE_COMMON_PATH FILE_COMMON path=",common);
}

void FinishMode(const string marker)
{
   if(tov2_file_failures==0)
      Print(marker," checks=",tov2_file_checks," failures=0");
   else
      Print("TOV2_FILE_STORE_FAIL mode=",TestMode," checks=",tov2_file_checks,
            " failures=",tov2_file_failures);
}

void RunLocal()
{
   RunDeterministicFakeSuite();
   PrintCommonPath();
   CTov2TelemetryMqlFileOps native_ops;
   native_ops.EnableTrace();
   CTov2TelemetryFileStore store(GetPointer(native_ops)); string token="";
   int acquired=store.Acquire(TOV2_NATIVE_KEY,token);
   native_ops.DisableTrace();
   Print("TOV2_ACQUIRE_RESULT result=",acquired,
         " token_empty=",(token=="" ? 1 : 0));
   Check(acquired==TOV2_STORE_ACQUIRED,"local.acquire");
   if(acquired!=TOV2_STORE_ACQUIRED)
   {
      FinishMode("TOV2_FILE_STORE_LOCAL_PASS");
      return;
   }
   Tov2StorageEntry start_entries[];
   int start_result=store.Inventory(token,start_entries);
   bool start_exact=ExactInventory(start_entries,0,0,0);
   int start_count=ObservedEntryCount(start_entries);
   Check(start_exact,"local.start.owner_only");
   Check(start_result==TOV2_STORE_OK && start_count==1,"start.local_exact");
   if(start_result!=TOV2_STORE_OK || !start_exact)
   {
      store.Close(token);
      FinishMode("TOV2_FILE_STORE_LOCAL_PASS");
      return;
   }

   Tov2StorageLocator locator=Tov2StorageObjectLocator(TOV2_NATIVE_LOCAL_GENERATION,1);
   uchar frame[]; bool encoded=MakeFrame(TOV2_NATIVE_LOCAL_GENERATION,161,frame);
   int created=store.CreateExact(token,locator,frame);
   uchar read_back[]; int read_result=store.Read(token,locator,read_back);
   bool binary_same=SameBytes(frame,read_back);
   int expected_count=ObservedByteCount(frame);
   int actual_count=ObservedByteCount(read_back);
   Check(encoded && binary_same,"local.binary.exact_bytes");
   Check(created==TOV2_STORE_CREATED && read_result==TOV2_STORE_OK &&
         expected_count==actual_count,"local.binary_nul_non_utf8");

   int same_result=store.CreateExact(token,locator,frame);
   Check(same_result==TOV2_STORE_EXISTS_SAME,"local.existing_same");

   uchar different[]; MakeFrame(TOV2_NATIVE_LOCAL_GENERATION,162,different);
   int conflict_result=store.CreateExact(token,locator,different);
   uchar preserved[]; int preserved_result=store.Read(token,locator,preserved);
   bool preserved_same=SameBytes(frame,preserved);
   int preserved_count=ObservedByteCount(preserved);
   Check(preserved_same,"local.conflict.exact_bytes");
   Check(conflict_result==TOV2_STORE_CONFLICT &&
         preserved_result==TOV2_STORE_OK && preserved_count==expected_count,
         "local.conflict_preserved");

   string digest=""; bool hashed=Tov2LocalHash(frame,digest);
   int deleted=store.DeleteExact(token,locator,digest);
   Check(hashed && deleted==TOV2_STORE_DELETED,"local.delete_exact");
   store.Close(token);

   string second_token=""; int reacquired=store.Acquire(TOV2_NATIVE_KEY,second_token);
   int live=store.Revalidate(second_token);
   Check(reacquired==TOV2_STORE_ACQUIRED && live==TOV2_STORE_OK,
         "local.release_reacquire");
   Tov2StorageEntry end_entries[]; int end_result=store.Inventory(second_token,end_entries);
   bool owner_only=ExactInventory(end_entries,0,0,0);
   int end_count=ObservedEntryCount(end_entries);
   Check(owner_only,"local.end.owner_only");
   Check(end_result==TOV2_STORE_OK && end_count==1,"local.owner_lock_retained");
   store.Close(second_token);
   FinishMode("TOV2_FILE_STORE_LOCAL_PASS");
}

void RunHoldLock()
{
   PrintCommonPath();
   CTov2TelemetryFileStore store; string token="";
   int acquired=store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageEntry entries[]; int inventory_result=store.Inventory(token,entries);
   bool lock_exact=ExactInventory(entries,0,0,0);
   int lock_count=ObservedEntryCount(entries);
   Check(lock_exact,"hold.start.owner_only");
   Check(acquired==TOV2_STORE_ACQUIRED && inventory_result==TOV2_STORE_OK &&
         lock_count==1,"start.lock_exact");
   if(acquired!=TOV2_STORE_ACQUIRED || inventory_result!=TOV2_STORE_OK || !lock_exact)
   {
      store.Close(token);
      FinishMode("TOV2_FILE_STORE_HOLD_LOCK_PASS");
      return;
   }
   int bounded=HoldSeconds;
   if(bounded<1) bounded=1;
   if(bounded>300) bounded=300;
   int live=store.Revalidate(token);
   Check(live==TOV2_STORE_OK,"hold.owner_live");
   if(live!=TOV2_STORE_OK)
   {
      store.Close(token);
      FinishMode("TOV2_FILE_STORE_HOLD_LOCK_PASS");
      return;
   }
   Print("TOV2_FILE_STORE_HOLD_READY seconds=",bounded);
   Sleep(bounded*1000);
   int after=store.Revalidate(token);
   Check(after==TOV2_STORE_OK,"hold.owner_after_wait");
   store.Close(token);
   FinishMode("TOV2_FILE_STORE_HOLD_LOCK_PASS");
}

void RunProbeLock()
{
   PrintCommonPath();
   CTov2TelemetryFileStore store; string token="";
   int acquired=store.Acquire(TOV2_NATIVE_KEY,token);
   if(acquired!=TOV2_STORE_BUSY)
   {
      Check(acquired==TOV2_STORE_BUSY,"probe.lock_busy_precondition");
      if(acquired==TOV2_STORE_ACQUIRED) store.Close(token);
      FinishMode("TOV2_FILE_STORE_PROBE_LOCK_PASS");
      return;
   }
   Tov2StorageEntry entries[]; int inventory_result=store.Inventory(token,entries);
   Tov2StorageLocator locator=Tov2StorageObjectLocator(TOV2_NATIVE_LOCAL_GENERATION,1);
   uchar bytes[]; int read_result=store.Read(token,locator,bytes);
   int byte_count=ObservedByteCount(bytes);
   uchar frame[]; MakeFrame(TOV2_NATIVE_LOCAL_GENERATION,181,frame);
   string digest=""; Tov2LocalHash(frame,digest);
   int revalidate_result=store.Revalidate(token);
   int create_result=store.CreateExact(token,locator,frame);
   int delete_result=store.DeleteExact(token,locator,digest);
   Check(acquired==TOV2_STORE_BUSY &&
         revalidate_result==TOV2_STORE_OWNERSHIP_LOST &&
         inventory_result==TOV2_STORE_OWNERSHIP_LOST &&
         read_result==TOV2_STORE_OWNERSHIP_LOST &&
         create_result==TOV2_STORE_OWNERSHIP_LOST &&
         delete_result==TOV2_STORE_OWNERSHIP_LOST && byte_count==0,
         "probe.no_method_succeeded");
   FinishMode("TOV2_FILE_STORE_PROBE_LOCK_PASS");
}

void RunProbeAfterRelease()
{
   PrintCommonPath();
   CTov2TelemetryFileStore store; string token="";
   int acquired=store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageEntry before[]; int before_result=store.Inventory(token,before);
   bool exact=ExactInventory(before,0,0,0);
   bool start_ready=acquired==TOV2_STORE_ACQUIRED &&
                    before_result==TOV2_STORE_OK && exact;
   Check(start_ready,"probe.after_release_start");
   if(acquired!=TOV2_STORE_ACQUIRED || before_result!=TOV2_STORE_OK || !exact)
   {
      store.Close(token);
      FinishMode("TOV2_FILE_STORE_PROBE_AFTER_RELEASE_PASS");
      return;
   }
   string before_sha=""; bool before_hashed=InventoryDigest(before,before_sha);
   int live=store.Revalidate(token);
   Tov2StorageEntry after[]; int after_result=store.Inventory(token,after);
   string after_sha=""; bool after_hashed=InventoryDigest(after,after_sha);
   Check(acquired==TOV2_STORE_ACQUIRED && before_result==TOV2_STORE_OK &&
         exact && before_hashed && live==TOV2_STORE_OK &&
         after_result==TOV2_STORE_OK && after_hashed && before_sha==after_sha,
         "probe.after_release_unchanged");
   store.Close(token);
   FinishMode("TOV2_FILE_STORE_PROBE_AFTER_RELEASE_PASS");
}

void RunWriteFixture()
{
   PrintCommonPath();
   CTov2TelemetryFileStore store; string token="";
   int acquired=store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageEntry start[]; int inventory_result=store.Inventory(token,start);
   bool owner_only=ExactInventory(start,0,0,0);
   bool fixture_present=ExactInventory(start,TOV2_LOC_OBJECT,
                                       TOV2_NATIVE_FIXTURE_GENERATION,1);
   int exact_cases=(int)owner_only+(int)fixture_present;
   int fixture_count=ObservedEntryCount(start);
   Check(exact_cases==1,"fixture.start.allowed_only");
   Check(acquired==TOV2_STORE_ACQUIRED && inventory_result==TOV2_STORE_OK &&
         fixture_count>=1,"start.fixture_exact");
   Check(inventory_result==TOV2_STORE_OK && exact_cases==1,"start.unrelated_refused");
   if(acquired!=TOV2_STORE_ACQUIRED || inventory_result!=TOV2_STORE_OK || exact_cases!=1)
   {
      store.Close(token);
      FinishMode("TOV2_FILE_STORE_WRITE_FIXTURE_PASS");
      return;
   }
   uchar frame[]; bool encoded=MakeFrame(TOV2_NATIVE_FIXTURE_GENERATION,177,frame);
   Tov2StorageLocator locator=Tov2StorageObjectLocator(TOV2_NATIVE_FIXTURE_GENERATION,1);
   int first=store.CreateExact(token,locator,frame);
   int repeated=store.CreateExact(token,locator,frame);
   bool first_allowed=first==TOV2_STORE_CREATED || first==TOV2_STORE_EXISTS_SAME;
   Check(encoded && first_allowed,"fixture.writer.first_allowed");
   Check(repeated==TOV2_STORE_EXISTS_SAME,"fixture.repeat_exists_same");
   store.Close(token);
   FinishMode("TOV2_FILE_STORE_WRITE_FIXTURE_PASS");
}

void RunReadFixture()
{
   PrintCommonPath();
   CTov2TelemetryFileStore store; string token="";
   int acquired=store.Acquire(TOV2_NATIVE_KEY,token);
   Tov2StorageEntry start[]; int inventory_result=store.Inventory(token,start);
   bool fixture_exact=ExactInventory(start,TOV2_LOC_OBJECT,
                                     TOV2_NATIVE_FIXTURE_GENERATION,1);
   bool start_ready=acquired==TOV2_STORE_ACQUIRED &&
                    inventory_result==TOV2_STORE_OK && fixture_exact;
   Check(start_ready,"fixture.reader_start");
   if(acquired!=TOV2_STORE_ACQUIRED || inventory_result!=TOV2_STORE_OK || !fixture_exact)
   {
      store.Close(token);
      FinishMode("TOV2_FILE_STORE_READ_FIXTURE_PASS");
      return;
   }
   uchar expected[]; bool encoded=MakeFrame(TOV2_NATIVE_FIXTURE_GENERATION,177,expected);
   Tov2StorageLocator locator=Tov2StorageObjectLocator(TOV2_NATIVE_FIXTURE_GENERATION,1);
   uchar actual[]; int read_result=store.Read(token,locator,actual);
   bool same=SameBytes(expected,actual);
   int expected_count=ObservedByteCount(expected);
   int actual_count=ObservedByteCount(actual);
   Check(fixture_exact && encoded && same,"fixture.reader.exact_bytes");
   Check(acquired==TOV2_STORE_ACQUIRED && inventory_result==TOV2_STORE_OK &&
         read_result==TOV2_STORE_OK && expected_count==actual_count,
         "fixture.reader_no_rewrite");
   store.Close(token);
   FinishMode("TOV2_FILE_STORE_READ_FIXTURE_PASS");
}

void OnStart()
{
   tov2_file_checks=0;
   tov2_file_failures=0;
   string derived_key="";
   bool key_valid=Tov2LocalInstallationKey(TOV2_NATIVE_IDENTITY,derived_key) &&
                  derived_key==TOV2_NATIVE_KEY;
   Check(key_valid,"native.identity_key");
   if(!key_valid)
   {
      Print("TOV2_FILE_STORE_FAIL mode=",TestMode," checks=",tov2_file_checks,
            " failures=",tov2_file_failures);
      return;
   }
   if(TestMode=="LOCAL") { RunLocal(); }
   else if(TestMode=="HOLD_LOCK") { RunHoldLock(); }
   else if(TestMode=="PROBE_LOCK") { RunProbeLock(); }
   else if(TestMode=="PROBE_AFTER_RELEASE") { RunProbeAfterRelease(); }
   else if(TestMode=="WRITE_FIXTURE") { RunWriteFixture(); }
   else if(TestMode=="READ_FIXTURE") { RunReadFixture(); }
   else
   {
      tov2_file_failures=1;
      Print("TOV2_FILE_STORE_FAIL mode=",TestMode," checks=0 failures=1");
   }
}
