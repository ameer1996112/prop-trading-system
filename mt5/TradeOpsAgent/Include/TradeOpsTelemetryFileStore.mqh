#ifndef TRADEOPS_TELEMETRY_FILE_STORE_MQH
#define TRADEOPS_TELEMETRY_FILE_STORE_MQH
#include "TradeOpsTelemetryStorage.mqh"

const string TOV2_FILE_STORE_NAMESPACE="TradeOpsTelemetry\\v2";
const string TOV2_FILE_STORE_SEPARATOR="\\";
const string TOV2_FILE_STORE_FORWARD="/";
const string TOV2_FILE_STORE_OWNER_NAME="owner.lock";
const string TOV2_FILE_STORE_REGISTRATION_NAME="registration.rec";
const string TOV2_FILE_STORE_OBJECTS_NAME="objects";
const string TOV2_FILE_STORE_STATES_NAME="states";
const string TOV2_FILE_STORE_COMMITS_NAME="commits";

class ITov2TelemetryFileOps
{
public:
   virtual bool FolderCreateCommon(const string path,int &native_error)=0;
   virtual long FindFirstCommon(const string filter,string &name,int &native_error)=0;
   virtual bool FindNext(const long search_handle,string &name,int &native_error)=0;
   virtual bool FindClose(const long search_handle,int &native_error)=0;
   virtual long PathIntegerCommon(const string path,const ENUM_FILE_PROPERTY_INTEGER property,int &native_error)=0;
   virtual int OpenCommon(const string path,const int flags,int &native_error)=0;
   virtual long HandleInteger(const int handle,const ENUM_FILE_PROPERTY_INTEGER property,int &native_error)=0;
   virtual uint ReadBytes(const int handle,uchar &bytes[],const int start,const int count,int &native_error)=0;
   virtual uint WriteBytes(const int handle,const uchar &bytes[],const int start,const int count,int &native_error)=0;
   virtual bool Flush(const int handle,int &native_error)=0;
   virtual bool CloseFile(const int handle,int &native_error)=0;
   virtual bool DeleteFileCommon(const string path,int &native_error)=0;
   virtual int ResizeBytes(uchar &bytes[],const int count,int &native_error)=0;
   virtual int CopyBytes(uchar &destination[],const uchar &source[],const int destination_start,const int source_start,const int count,int &native_error)=0;
   virtual int ResizeEntries(Tov2StorageEntry &entries[],const int count,int &native_error)=0;
   virtual bool HashBytes(const uchar &bytes[],string &sha,int &native_error)=0;
};

class CTov2TelemetryMqlFileOps : public ITov2TelemetryFileOps
{
private:
   bool m_trace;

   void TracePath(const string operation,const string path,const long result,
                  const int native_error)
   {
      if(m_trace)
         Print("TOV2_ACQUIRE_TRACE op=",operation," path=",path,
               " result=",result," error=",native_error);
   }

   void TraceHandle(const string operation,const long handle,const long result,
                    const int native_error)
   {
      if(m_trace)
         Print("TOV2_ACQUIRE_TRACE op=",operation," handle=",handle,
               " result=",result," error=",native_error);
   }

   void TraceEntry(const string operation,const string name,const long result,
                   const int native_error)
   {
      if(m_trace)
         Print("TOV2_ACQUIRE_ENTRY op=",operation," name=",name,
               " chars=",StringLen(name)," result=",result,
               " error=",native_error);
   }

   void NormalizeFoundName(string &name)
   {
      int count=StringLen(name);
      if(count<1) return;
      ushort last=(ushort)StringGetCharacter(name,count-1);
      if(last==47 || last==92) name=StringSubstr(name,0,count-1);
   }

public:
   CTov2TelemetryMqlFileOps() { m_trace=false; }
   void EnableTrace() { m_trace=true; }
   void DisableTrace() { m_trace=false; }

   bool FolderCreateCommon(const string path,int &native_error)
   {
      ResetLastError();
      bool result=FolderCreate(path,FILE_COMMON);
      native_error=GetLastError();
      TracePath("folder_create",path,(result ? 1 : 0),native_error);
      return result;
   }

   long FindFirstCommon(const string filter,string &name,int &native_error)
   {
      ResetLastError();
      long result=FileFindFirst(filter,name,FILE_COMMON);
      native_error=GetLastError();
      if(result!=INVALID_HANDLE) NormalizeFoundName(name);
      TracePath("find_first",filter,result,native_error);
      TraceEntry("find_first",name,result,native_error);
      if(result==INVALID_HANDLE) return INVALID_HANDLE;
      return result;
   }

   bool FindNext(const long search_handle,string &name,int &native_error)
   {
      ResetLastError();
      bool result=FileFindNext(search_handle,name);
      native_error=GetLastError();
      if(result) NormalizeFoundName(name);
      TraceHandle("find_next",search_handle,(result ? 1 : 0),native_error);
      TraceEntry("find_next",name,(result ? 1 : 0),native_error);
      return result;
   }

   bool FindClose(const long search_handle,int &native_error)
   {
      ResetLastError();
      FileFindClose(search_handle);
      native_error=GetLastError();
      TraceHandle("find_close",search_handle,(native_error==0 ? 1 : 0),
                  native_error);
      return native_error==0;
   }

   long PathIntegerCommon(const string path,const ENUM_FILE_PROPERTY_INTEGER property,int &native_error)
   {
      ResetLastError();
      long result=FileGetInteger(path,property,true);
      native_error=GetLastError();
      TracePath("path_integer",path,result,native_error);
      return result;
   }

   int OpenCommon(const string path,const int flags,int &native_error)
   {
      // Store callers supply FILE_BIN; no sharing or text flags are added here.
      ResetLastError();
      int result=FileOpen(path,flags|FILE_COMMON);
      native_error=GetLastError();
      TracePath("open",path,result,native_error);
      return result;
   }

   long HandleInteger(const int handle,const ENUM_FILE_PROPERTY_INTEGER property,int &native_error)
   {
      ResetLastError();
      long result=FileGetInteger(handle,property);
      native_error=GetLastError();
      TraceHandle("handle_integer",handle,result,native_error);
      return result;
   }

   uint ReadBytes(const int handle,uchar &bytes[],const int start,const int count,int &native_error)
   {
      ResetLastError();
      uint result=FileReadArray(handle,bytes,start,count);
      native_error=GetLastError();
      return result;
   }

   uint WriteBytes(const int handle,const uchar &bytes[],const int start,const int count,int &native_error)
   {
      ResetLastError();
      uint result=FileWriteArray(handle,bytes,start,count);
      native_error=GetLastError();
      return result;
   }

   bool Flush(const int handle,int &native_error)
   {
      ResetLastError();
      FileFlush(handle);
      native_error=GetLastError();
      return native_error==0;
   }

   bool CloseFile(const int handle,int &native_error)
   {
      ResetLastError();
      FileClose(handle);
      native_error=GetLastError();
      TraceHandle("close",handle,(native_error==0 ? 1 : 0),native_error);
      return native_error==0;
   }

   bool DeleteFileCommon(const string path,int &native_error)
   {
      ResetLastError();
      bool result=FileDelete(path,FILE_COMMON);
      native_error=GetLastError();
      return result;
   }

   int ResizeBytes(uchar &bytes[],const int count,int &native_error)
   {
      ResetLastError();
      int result=ArrayResize(bytes,count);
      native_error=GetLastError();
      return result;
   }

   int CopyBytes(uchar &destination[],const uchar &source[],const int destination_start,const int source_start,const int count,int &native_error)
   {
      ResetLastError();
      int result=ArrayCopy(destination,source,destination_start,source_start,count);
      native_error=GetLastError();
      return result;
   }

   int ResizeEntries(Tov2StorageEntry &entries[],const int count,int &native_error)
   {
      ResetLastError();
      int result=ArrayResize(entries,count);
      native_error=GetLastError();
      return result;
   }

   bool HashBytes(const uchar &bytes[],string &sha,int &native_error)
   {
      ResetLastError();
      bool result=Tov2LocalHash(bytes,sha);
      native_error=GetLastError();
      return result;
   }
};

struct Tov2FileStoreProbe
{
   bool found;
   bool directory;
   long size;
};

void Tov2FileStoreClearProbe(Tov2FileStoreProbe &probe)
{
   probe.found=false;
   probe.directory=false;
   probe.size=0;
}

class CTov2TelemetryFileStore : public ITov2TelemetryStorage
{
private:
   CTov2TelemetryMqlFileOps m_default_ops;
   ITov2TelemetryFileOps *m_ops;
   string m_installation_key;
   string m_root;
   string m_session_token;
   int m_owner_handle;
   long m_session_serial;

   CTov2TelemetryFileStore(const CTov2TelemetryFileStore &other)=delete;
   void operator=(const CTov2TelemetryFileStore &other)=delete;

   bool OpsReady()
   {
      return CheckPointer(m_ops)!=POINTER_INVALID;
   }

   bool BasenameValid(const string name)
   {
      int count=StringLen(name);
      if(count<1) return false;
      if(count==1 && StringGetCharacter(name,0)==46) return false;
      if(count==2 && StringGetCharacter(name,0)==46 &&
         StringGetCharacter(name,1)==46) return false;
      for(int i=0;i<count;i++)
      {
         ushort c=(ushort)StringGetCharacter(name,i);
         if(c==47 || c==92 || c==0) return false;
      }
      return true;
   }

   bool IsPseudoEntry(const string name)
   {
      return name=="." || name=="..";
   }

   ushort FoldAscii(const ushort value)
   {
      if(value>=65 && value<=90) return value+32;
      return value;
   }

   bool SameFolded(const string left,const string right)
   {
      int count=StringLen(left);
      if(count!=StringLen(right)) return false;
      for(int i=0;i<count;i++)
         if(FoldAscii((ushort)StringGetCharacter(left,i))!=
            FoldAscii((ushort)StringGetCharacter(right,i))) return false;
      return true;
   }

   bool ConfirmDirectory(const string path)
   {
      if(!OpsReady()) return false;
      int native_error=0;
      long exists=m_ops.PathIntegerCommon(path,FILE_EXISTS,native_error);
      return exists==1 && native_error==ERR_FILE_IS_DIRECTORY;
   }

   int ExpectedParentStatus(const string path)
   {
      if(!OpsReady()) return TOV2_STORE_IO_ERROR;
      int native_error=0;
      long exists=m_ops.PathIntegerCommon(path,FILE_EXISTS,native_error);
      if(exists>0 && native_error==ERR_FILE_IS_DIRECTORY)
         return TOV2_STORE_OK;
      if(exists<=0 && (native_error==ERR_FILE_NOT_EXIST ||
                       native_error==ERR_DIRECTORY_NOT_EXIST))
         return TOV2_STORE_CONFLICT;
      if(native_error==0 && (exists==0 || exists==1))
         return TOV2_STORE_CONFLICT;
      return TOV2_STORE_IO_ERROR;
   }

   bool EnsureDirectory(const string path)
   {
      if(!OpsReady()) return false;
      int create_error=0;
      bool created=m_ops.FolderCreateCommon(path,create_error);
      if(created && create_error!=0) return false;
      return ConfirmDirectory(path);
   }

   int InspectChild(const string parent,const string name,bool &directory,long &size)
   {
      directory=false;
      size=0;
      if(!OpsReady()) return TOV2_STORE_IO_ERROR;
      if(!BasenameValid(name)) return TOV2_STORE_CONFLICT;
      string path=parent+TOV2_FILE_STORE_SEPARATOR+name;
      int native_error=0;
      long exists=m_ops.PathIntegerCommon(path,FILE_EXISTS,native_error);
      if(exists==1 && native_error==ERR_FILE_IS_DIRECTORY)
      {
         directory=true;
         return TOV2_STORE_OK;
      }
      if(exists!=1 || native_error!=0) return TOV2_STORE_IO_ERROR;
      size=m_ops.PathIntegerCommon(path,FILE_SIZE,native_error);
      if(native_error!=0 || size<0) return TOV2_STORE_IO_ERROR;
      return TOV2_STORE_OK;
   }

   int ProbeChild(const string parent,const string target,
                  const bool expected_parent,Tov2FileStoreProbe &probe)
   {
      Tov2FileStoreClearProbe(probe);
      if(!BasenameValid(target)) return TOV2_STORE_INVALID;
      if(!OpsReady()) return TOV2_STORE_IO_ERROR;
      if(expected_parent)
      {
         int parent_status=ExpectedParentStatus(parent);
         if(parent_status!=TOV2_STORE_OK) return parent_status;
      }
      string name="";
      int native_error=0;
      long search=m_ops.FindFirstCommon(parent+TOV2_FILE_STORE_SEPARATOR+"*",name,native_error);
      if(search==INVALID_HANDLE)
      {
         if(expected_parent) return ExpectedParentStatus(parent);
         if(ConfirmDirectory(parent)) return TOV2_STORE_OK;
         return TOV2_STORE_IO_ERROR;
      }

      int result=(native_error==0 ? TOV2_STORE_OK : TOV2_STORE_IO_ERROR);
      int matches=0;
      bool more=(result==TOV2_STORE_OK);
      while(more)
      {
         if(IsPseudoEntry(name))
         {
            native_error=0;
            more=m_ops.FindNext(search,name,native_error);
            if(!more && native_error!=0 && native_error!=ERR_FILE_NOT_EXIST)
               result=TOV2_STORE_IO_ERROR;
            continue;
         }
         bool directory=false;
         long size=0;
         int inspected=InspectChild(parent,name,directory,size);
         if(inspected!=TOV2_STORE_OK)
         {
            result=inspected;
            break;
         }
         if(SameFolded(name,target))
         {
            matches++;
            if(name!=target || matches!=1)
            {
               result=TOV2_STORE_CONFLICT;
               break;
            }
            probe.found=true;
            probe.directory=directory;
            probe.size=size;
         }
         native_error=0;
         more=m_ops.FindNext(search,name,native_error);
         if(!more && native_error!=0 && native_error!=ERR_FILE_NOT_EXIST)
            result=TOV2_STORE_IO_ERROR;
      }
      int close_error=0;
      bool closed=m_ops.FindClose(search,close_error);
      if(!closed || close_error!=0) result=TOV2_STORE_IO_ERROR;
      if(expected_parent && result==TOV2_STORE_OK)
      {
         int parent_status=ExpectedParentStatus(parent);
         if(parent_status!=TOV2_STORE_OK) result=parent_status;
      }
      if(result!=TOV2_STORE_OK) Tov2FileStoreClearProbe(probe);
      return result;
   }

   bool LocatorPath(const Tov2StorageLocator &locator,string &parent,
                    string &name,string &path)
   {
      parent="";
      name="";
      path="";
      string relative=Tov2StorageRelativePath(locator);
      if(relative=="") return false;
      if(locator.kind==TOV2_LOC_OWNER || locator.kind==TOV2_LOC_REGISTRATION)
      {
         parent=m_root;
         name=relative;
      }
      else if(locator.kind==TOV2_LOC_OBJECT)
      {
         parent=m_root+TOV2_FILE_STORE_SEPARATOR+TOV2_FILE_STORE_OBJECTS_NAME;
         name=StringSubstr(relative,StringLen(TOV2_FILE_STORE_OBJECTS_NAME)+1);
      }
      else if(locator.kind==TOV2_LOC_STATE)
      {
         parent=m_root+TOV2_FILE_STORE_SEPARATOR+TOV2_FILE_STORE_STATES_NAME;
         name=StringSubstr(relative,StringLen(TOV2_FILE_STORE_STATES_NAME)+1);
      }
      else if(locator.kind==TOV2_LOC_COMMIT)
      {
         parent=m_root+TOV2_FILE_STORE_SEPARATOR+TOV2_FILE_STORE_COMMITS_NAME;
         name=StringSubstr(relative,StringLen(TOV2_FILE_STORE_COMMITS_NAME)+1);
      }
      else return false;
      path=parent+TOV2_FILE_STORE_SEPARATOR+name;
      string canonical=relative;
      StringReplace(canonical,TOV2_FILE_STORE_FORWARD,TOV2_FILE_STORE_SEPARATOR);
      return path==m_root+TOV2_FILE_STORE_SEPARATOR+canonical && BasenameValid(name);
   }

   bool ClearBytes(uchar &bytes[])
   {
      if(!OpsReady()) return false;
      int native_error=0;
      return m_ops.ResizeBytes(bytes,0,native_error)==0 && native_error==0;
   }

   bool ClearEntries(Tov2StorageEntry &entries[])
   {
      if(!OpsReady()) return false;
      int native_error=0;
      return m_ops.ResizeEntries(entries,0,native_error)==0 && native_error==0;
   }

   bool CloseHandle(const int handle)
   {
      if(handle==INVALID_HANDLE) return true;
      if(!OpsReady()) return false;
      int native_error=0;
      bool closed=m_ops.CloseFile(handle,native_error);
      return closed && native_error==0;
   }

   bool InvalidateAndClose()
   {
      int held=m_owner_handle;
      m_session_token="";
      m_installation_key="";
      m_root="";
      m_owner_handle=INVALID_HANDLE;
      return CloseHandle(held);
   }

   bool SessionMatches(const string session_token)
   {
      return OpsReady() && session_token!="" && session_token==m_session_token &&
             m_session_token!="" && m_owner_handle!=INVALID_HANDLE &&
             Tov2Digest(m_installation_key) &&
             m_root==TOV2_FILE_STORE_NAMESPACE+TOV2_FILE_STORE_SEPARATOR+
                     m_installation_key;
   }

   int ReadKnownFile(const string path,const long known_size,uchar &bytes[])
   {
      if(!OpsReady()) return TOV2_STORE_IO_ERROR;
      if(!ClearBytes(bytes)) return TOV2_STORE_IO_ERROR;
      if(known_size<1 || known_size>TOV2_RECORD_FRAME_MAX)
         return TOV2_STORE_IO_ERROR;
      int count=(int)known_size;
      int native_error=0;
      int flags=FILE_BIN|FILE_READ;
      int handle=m_ops.OpenCommon(path,flags,native_error);
      if(handle==INVALID_HANDLE) return TOV2_STORE_IO_ERROR;
      if(native_error!=0)
      {
         CloseHandle(handle);
         return TOV2_STORE_IO_ERROR;
      }

      int result=TOV2_STORE_OK;
      long opened_size=m_ops.HandleInteger(handle,FILE_SIZE,native_error);
      if(native_error!=0 || opened_size!=known_size) result=TOV2_STORE_IO_ERROR;
      uchar staged[];
      if(result==TOV2_STORE_OK &&
         (m_ops.ResizeBytes(staged,count,native_error)!=count || native_error!=0))
         result=TOV2_STORE_IO_ERROR;
      if(result==TOV2_STORE_OK)
      {
         int requested=count;
         uint read_count=m_ops.ReadBytes(handle,staged,0,requested,native_error);
         if(native_error!=0 || read_count!=(uint)requested) result=TOV2_STORE_IO_ERROR;
      }
      if(result==TOV2_STORE_OK)
      {
         long position=m_ops.HandleInteger(handle,FILE_POSITION,native_error);
         if(native_error!=0 || position!=known_size) result=TOV2_STORE_IO_ERROR;
      }
      if(result==TOV2_STORE_OK)
      {
         long final_size=m_ops.HandleInteger(handle,FILE_SIZE,native_error);
         if(native_error!=0 || final_size!=known_size) result=TOV2_STORE_IO_ERROR;
      }
      if(!CloseHandle(handle)) result=TOV2_STORE_IO_ERROR;
      if(result==TOV2_STORE_OK)
      {
         if(m_ops.ResizeBytes(bytes,count,native_error)!=count || native_error!=0 ||
            m_ops.CopyBytes(bytes,staged,0,0,count,native_error)!=count ||
            native_error!=0) result=TOV2_STORE_IO_ERROR;
      }
      if(result!=TOV2_STORE_OK) ClearBytes(bytes);
      return result;
   }

   bool BytesEqual(const uchar &left[],const uchar &right[])
   {
      int count=ArraySize(left);
      if(count!=ArraySize(right)) return false;
      for(int i=0;i<count;i++) if(left[i]!=right[i]) return false;
      return true;
   }

   bool ParseRecordName(const int kind,const string name,Tov2StorageLocator &locator)
   {
      Tov2StorageClearLocator(locator);
      if(kind==TOV2_LOC_REGISTRATION)
      {
         if(name!=TOV2_FILE_STORE_REGISTRATION_NAME) return false;
         locator=Tov2StorageRegistrationLocator();
         return Tov2StorageLocatorValid(locator) &&
                Tov2StorageRelativePath(locator)==name;
      }
      int count=StringLen(name);
      if(count<=4 || StringSubstr(name,count-4)!=".rec") return false;
      string stem=StringSubstr(name,0,count-4);
      long generation=0;
      long ordinal=0;
      if(kind==TOV2_LOC_OBJECT)
      {
         int dash=StringFind(stem,"-");
         if(dash<1 || StringFind(stem,"-",dash+1)>=0) return false;
         if(!Tov2CounterFromText(StringSubstr(stem,0,dash),1,generation) ||
            !Tov2CounterFromText(StringSubstr(stem,dash+1),1,ordinal)) return false;
         locator=Tov2StorageObjectLocator(generation,ordinal);
      }
      else
      {
         if(!Tov2CounterFromText(stem,1,generation)) return false;
         if(kind==TOV2_LOC_STATE) locator=Tov2StorageStateLocator(generation);
         else if(kind==TOV2_LOC_COMMIT) locator=Tov2StorageCommitLocator(generation);
         else return false;
      }
      string relative=Tov2StorageRelativePath(locator);
      int slash=StringFind(relative,TOV2_FILE_STORE_FORWARD);
      if(slash<0 || StringSubstr(relative,slash+1)!=name) return false;
      return Tov2StorageLocatorValid(locator);
   }

   int AddEntry(Tov2StorageEntry &staged[],int &count,
                const Tov2StorageLocator &locator,const long size,
                const string sha)
   {
      if(!OpsReady()) return TOV2_STORE_IO_ERROR;
      if(count>=TOV2_STORAGE_INVENTORY_MAX) return TOV2_STORE_LIMIT;
      string relative=Tov2StorageRelativePath(locator);
      if(relative=="") return TOV2_STORE_CONFLICT;
      for(int i=0;i<count;i++)
         if(Tov2StorageSameLocator(staged[i].locator,locator) ||
            staged[i].relative_path==relative) return TOV2_STORE_CONFLICT;
      int native_error=0;
      if(m_ops.ResizeEntries(staged,count+1,native_error)!=count+1 ||
         native_error!=0) return TOV2_STORE_IO_ERROR;
      staged[count].locator=locator;
      staged[count].relative_path=relative;
      staged[count].size=size;
      staged[count].sha=sha;
      if(!Tov2StorageEntryValid(staged[count])) return TOV2_STORE_CONFLICT;
      count++;
      return TOV2_STORE_OK;
   }

   int AddRecordEntry(const string parent,const string name,const int kind,
                      const long size,Tov2StorageEntry &staged[],int &count)
   {
      if(!OpsReady()) return TOV2_STORE_IO_ERROR;
      if(size<0) return TOV2_STORE_IO_ERROR;
      if(size>TOV2_RECORD_FRAME_MAX) return TOV2_STORE_LIMIT;
      Tov2StorageLocator locator;
      if(!ParseRecordName(kind,name,locator)) return TOV2_STORE_CONFLICT;
      if(count>=TOV2_STORAGE_INVENTORY_MAX) return TOV2_STORE_LIMIT;
      if(size==0) return TOV2_STORE_CONFLICT;
      uchar bytes[];
      if(ReadKnownFile(parent+TOV2_FILE_STORE_SEPARATOR+name,size,bytes)!=
         TOV2_STORE_OK) return TOV2_STORE_IO_ERROR;
      int native_error=0;
      string sha="";
      if(!m_ops.HashBytes(bytes,sha,native_error) || native_error!=0 ||
         !Tov2Digest(sha)) return TOV2_STORE_IO_ERROR;
      return AddEntry(staged,count,locator,size,sha);
   }

   int EnumerateRoot(Tov2StorageEntry &staged[],int &count)
   {
      if(!OpsReady()) return TOV2_STORE_IO_ERROR;
      string name="";
      int native_error=0;
      long search=m_ops.FindFirstCommon(m_root+TOV2_FILE_STORE_SEPARATOR+"*",
                                        name,native_error);
      if(search==INVALID_HANDLE)
      {
         if(ConfirmDirectory(m_root)) return TOV2_STORE_CONFLICT;
         return TOV2_STORE_IO_ERROR;
      }
      int result=(native_error==0 ? TOV2_STORE_OK : TOV2_STORE_IO_ERROR);
      int owner_count=0;
      int registration_count=0;
      int objects_count=0;
      int states_count=0;
      int commits_count=0;
      bool more=(result==TOV2_STORE_OK);
      while(more)
      {
         if(IsPseudoEntry(name))
         {
            native_error=0;
            more=m_ops.FindNext(search,name,native_error);
            if(!more && native_error!=0 && native_error!=ERR_FILE_NOT_EXIST)
               result=TOV2_STORE_IO_ERROR;
            continue;
         }
         bool directory=false;
         long size=0;
         if(name==TOV2_FILE_STORE_OWNER_NAME)
         {
            // The owner file is deliberately held without share flags.  Query it
            // through the live handle because Windows can reject path metadata
            // access while that exclusive handle is open.
            native_error=0;
            size=m_ops.HandleInteger(m_owner_handle,FILE_SIZE,native_error);
            if(native_error!=0 || size<0)
            {
               result=TOV2_STORE_IO_ERROR;
               break;
            }
         }
         else
         {
            int inspected=InspectChild(m_root,name,directory,size);
            if(inspected!=TOV2_STORE_OK)
            {
               result=inspected;
               break;
            }
         }
         if(name==TOV2_FILE_STORE_OWNER_NAME)
         {
            owner_count++;
            if(owner_count!=1 || directory || size!=0)
               result=TOV2_STORE_CONFLICT;
            else
            {
               Tov2StorageLocator owner=Tov2StorageOwnerLocator();
               result=AddEntry(staged,count,owner,0,"-");
            }
         }
         else if(name==TOV2_FILE_STORE_REGISTRATION_NAME)
         {
            registration_count++;
            if(registration_count!=1 || directory)
               result=TOV2_STORE_CONFLICT;
            else
               result=AddRecordEntry(m_root,name,TOV2_LOC_REGISTRATION,size,
                                     staged,count);
         }
         else if(name==TOV2_FILE_STORE_OBJECTS_NAME)
         {
            objects_count++;
            if(objects_count!=1 || !directory) result=TOV2_STORE_CONFLICT;
         }
         else if(name==TOV2_FILE_STORE_STATES_NAME)
         {
            states_count++;
            if(states_count!=1 || !directory) result=TOV2_STORE_CONFLICT;
         }
         else if(name==TOV2_FILE_STORE_COMMITS_NAME)
         {
            commits_count++;
            if(commits_count!=1 || !directory) result=TOV2_STORE_CONFLICT;
         }
         else if(SameFolded(name,TOV2_FILE_STORE_OWNER_NAME) ||
                 SameFolded(name,TOV2_FILE_STORE_REGISTRATION_NAME) ||
                 SameFolded(name,TOV2_FILE_STORE_OBJECTS_NAME) ||
                 SameFolded(name,TOV2_FILE_STORE_STATES_NAME) ||
                 SameFolded(name,TOV2_FILE_STORE_COMMITS_NAME))
            result=TOV2_STORE_CONFLICT;
         else result=TOV2_STORE_CONFLICT;

         if(result!=TOV2_STORE_OK) break;
         native_error=0;
         more=m_ops.FindNext(search,name,native_error);
         if(!more && native_error!=0 && native_error!=ERR_FILE_NOT_EXIST)
            result=TOV2_STORE_IO_ERROR;
      }
      int close_error=0;
      bool closed=m_ops.FindClose(search,close_error);
      if(!closed || close_error!=0) result=TOV2_STORE_IO_ERROR;
      if(result==TOV2_STORE_OK &&
         (owner_count!=1 || objects_count!=1 || states_count!=1 ||
          commits_count!=1)) result=TOV2_STORE_CONFLICT;
      return result;
   }

   int EnumerateRecords(const string container,const int kind,
                        Tov2StorageEntry &staged[],int &count)
   {
      if(!OpsReady()) return TOV2_STORE_IO_ERROR;
      string parent=m_root+TOV2_FILE_STORE_SEPARATOR+container;
      int parent_status=ExpectedParentStatus(parent);
      if(parent_status!=TOV2_STORE_OK) return parent_status;
      string name="";
      int native_error=0;
      long search=m_ops.FindFirstCommon(parent+TOV2_FILE_STORE_SEPARATOR+"*",
                                        name,native_error);
      if(search==INVALID_HANDLE)
         return ExpectedParentStatus(parent);
      int result=(native_error==0 ? TOV2_STORE_OK : TOV2_STORE_IO_ERROR);
      bool more=(result==TOV2_STORE_OK);
      while(more)
      {
         if(IsPseudoEntry(name))
         {
            native_error=0;
            more=m_ops.FindNext(search,name,native_error);
            if(!more && native_error!=0 && native_error!=ERR_FILE_NOT_EXIST)
               result=TOV2_STORE_IO_ERROR;
            continue;
         }
         bool directory=false;
         long size=0;
         int inspected=InspectChild(parent,name,directory,size);
         if(inspected!=TOV2_STORE_OK) result=inspected;
         else if(directory) result=TOV2_STORE_CONFLICT;
         else result=AddRecordEntry(parent,name,kind,size,staged,count);
         if(result!=TOV2_STORE_OK) break;
         native_error=0;
         more=m_ops.FindNext(search,name,native_error);
         if(!more && native_error!=0 && native_error!=ERR_FILE_NOT_EXIST)
            result=TOV2_STORE_IO_ERROR;
      }
      int close_error=0;
      bool closed=m_ops.FindClose(search,close_error);
      if(!closed || close_error!=0) result=TOV2_STORE_IO_ERROR;
      if(result==TOV2_STORE_OK)
      {
         parent_status=ExpectedParentStatus(parent);
         if(parent_status!=TOV2_STORE_OK) result=parent_status;
      }
      return result;
   }

   bool LocatorLess(const Tov2StorageLocator &left,
                    const Tov2StorageLocator &right)
   {
      if(left.kind!=right.kind) return left.kind<right.kind;
      if(left.generation!=right.generation)
         return left.generation<right.generation;
      return left.ordinal<right.ordinal;
   }

   void SortEntries(Tov2StorageEntry &entries[],const int count)
   {
      for(int i=1;i<count;i++)
      {
         int j=i;
         while(j>0 && LocatorLess(entries[j].locator,entries[j-1].locator))
         {
            Tov2StorageEntry temporary;
            temporary=entries[j-1];
            entries[j-1]=entries[j];
            entries[j]=temporary;
            j--;
         }
      }
   }

public:
   CTov2TelemetryFileStore()
   {
      m_ops=&m_default_ops;
      m_installation_key="";
      m_root="";
      m_session_token="";
      m_owner_handle=INVALID_HANDLE;
      m_session_serial=0;
   }

   CTov2TelemetryFileStore(ITov2TelemetryFileOps *file_ops)
   {
      if(file_ops==NULL) m_ops=&m_default_ops;
      else m_ops=file_ops;
      m_installation_key="";
      m_root="";
      m_session_token="";
      m_owner_handle=INVALID_HANDLE;
      m_session_serial=0;
   }

   ~CTov2TelemetryFileStore()
   {
      int held=m_owner_handle;
      m_session_token="";
      m_installation_key="";
      m_root="";
      m_owner_handle=INVALID_HANDLE;
      CloseHandle(held);
   }

   int Acquire(const string installation_key,string &session_token)
   {
      session_token="";
      if(!Tov2Digest(installation_key)) return TOV2_STORE_INVALID;
      if(!OpsReady()) return TOV2_STORE_IO_ERROR;
      if(m_owner_handle!=INVALID_HANDLE || m_session_token!="")
         return TOV2_STORE_BUSY;
      string candidate_root=TOV2_FILE_STORE_NAMESPACE+
                            TOV2_FILE_STORE_SEPARATOR+installation_key;
      if(!EnsureDirectory(candidate_root)) return TOV2_STORE_IO_ERROR;

      Tov2StorageLocator owner_locator=Tov2StorageOwnerLocator();
      string owner_relative=Tov2StorageRelativePath(owner_locator);
      Tov2FileStoreProbe owner_probe;
      int probed=ProbeChild(candidate_root,owner_relative,false,owner_probe);
      if(probed!=TOV2_STORE_OK) return probed;
      bool existing_owner=owner_probe.found;
      if(existing_owner && (owner_probe.directory || owner_probe.size!=0))
         return TOV2_STORE_CONFLICT;

      string owner_path=candidate_root+TOV2_FILE_STORE_SEPARATOR+owner_relative;
      int native_error=0;
      int flags=FILE_BIN|FILE_READ|FILE_WRITE;
      int handle=m_ops.OpenCommon(owner_path,flags,native_error);
      if(handle==INVALID_HANDLE)
      {
         if(existing_owner && native_error==ERR_CANNOT_OPEN_FILE)
            return TOV2_STORE_BUSY;
         return TOV2_STORE_IO_ERROR;
      }
      if(native_error!=0)
      {
         CloseHandle(handle);
         return TOV2_STORE_IO_ERROR;
      }

      m_owner_handle=handle;
      m_installation_key=installation_key;
      m_root=candidate_root;
      long lock_size=m_ops.HandleInteger(m_owner_handle,FILE_SIZE,native_error);
      if(native_error!=0 || lock_size!=0)
      {
         int result=(native_error==0 ? TOV2_STORE_CONFLICT : TOV2_STORE_IO_ERROR);
         if(!InvalidateAndClose()) result=TOV2_STORE_IO_ERROR;
         return result;
      }
      if(!EnsureDirectory(m_root+TOV2_FILE_STORE_SEPARATOR+
                          TOV2_FILE_STORE_OBJECTS_NAME) ||
         !EnsureDirectory(m_root+TOV2_FILE_STORE_SEPARATOR+
                          TOV2_FILE_STORE_STATES_NAME) ||
         !EnsureDirectory(m_root+TOV2_FILE_STORE_SEPARATOR+
                          TOV2_FILE_STORE_COMMITS_NAME))
      {
         InvalidateAndClose();
         return TOV2_STORE_IO_ERROR;
      }
      m_session_serial++;
      if(m_session_serial<1) m_session_serial=1;
      m_session_token="tov2.file.session."+Tov2LocalNumber(m_session_serial);
      if(m_session_token=="")
      {
         InvalidateAndClose();
         return TOV2_STORE_IO_ERROR;
      }
      session_token=m_session_token;
      return TOV2_STORE_ACQUIRED;
   }

   int Revalidate(const string session_token)
   {
      if(!OpsReady()) return TOV2_STORE_OWNERSHIP_LOST;
      if(!SessionMatches(session_token)) return TOV2_STORE_OWNERSHIP_LOST;
      int native_error=0;
      long lock_size=m_ops.HandleInteger(m_owner_handle,FILE_SIZE,native_error);
      if(native_error!=0 || lock_size!=0)
      {
         InvalidateAndClose();
         return TOV2_STORE_OWNERSHIP_LOST;
      }
      return TOV2_STORE_OK;
   }

   int Inventory(const string session_token,Tov2StorageEntry &entries[])
   {
      bool caller_cleared=ClearEntries(entries);
      int ownership=Revalidate(session_token);
      if(ownership!=TOV2_STORE_OK) return ownership;
      if(!caller_cleared) return TOV2_STORE_IO_ERROR;
      if(StringCompare(TOV2_FILE_STORE_OBJECTS_NAME,"objects")!=0 ||
         StringCompare(TOV2_FILE_STORE_STATES_NAME,"states")!=0 ||
         StringCompare(TOV2_FILE_STORE_COMMITS_NAME,"commits")!=0 ||
         StringCompare(TOV2_FILE_STORE_REGISTRATION_NAME,"registration.rec")!=0 ||
         StringCompare(StringSubstr(TOV2_FILE_STORE_REGISTRATION_NAME,
                                    StringLen(TOV2_FILE_STORE_REGISTRATION_NAME)-4),
                       ".rec")!=0) return TOV2_STORE_IO_ERROR;
      Tov2StorageEntry staged[];
      if(!ClearEntries(staged)) return TOV2_STORE_IO_ERROR;
      int count=0;
      int result=EnumerateRoot(staged,count);
      if(result==TOV2_STORE_OK)
         result=EnumerateRecords(TOV2_FILE_STORE_OBJECTS_NAME,TOV2_LOC_OBJECT,
                                 staged,count);
      if(result==TOV2_STORE_OK)
         result=EnumerateRecords(TOV2_FILE_STORE_STATES_NAME,TOV2_LOC_STATE,
                                 staged,count);
      if(result==TOV2_STORE_OK)
         result=EnumerateRecords(TOV2_FILE_STORE_COMMITS_NAME,TOV2_LOC_COMMIT,
                                 staged,count);
      ownership=Revalidate(session_token);
      if(ownership!=TOV2_STORE_OK) result=ownership;
      if(result!=TOV2_STORE_OK)
      {
         ClearEntries(entries);
         ClearEntries(staged);
         return result;
      }
      if(count>TOV2_STORAGE_INVENTORY_MAX)
      {
         ClearEntries(staged);
         return TOV2_STORE_LIMIT;
      }
      for(int i=0;i<count;i++)
      {
         if(staged[i].locator.kind!=TOV2_LOC_OWNER &&
            (staged[i].size<1 || staged[i].size>TOV2_RECORD_FRAME_MAX))
         {
            int invalid_entry_result=
               staged[i].size>TOV2_RECORD_FRAME_MAX ? TOV2_STORE_LIMIT :
                                                       TOV2_STORE_CONFLICT;
            ClearEntries(staged);
            return invalid_entry_result;
         }
         long checked_generation=0;
         if(!Tov2CounterFromText(Tov2LocalNumber(staged[i].locator.generation),
                                 0,checked_generation) ||
            checked_generation!=staged[i].locator.generation)
         {
            ClearEntries(staged);
            return TOV2_STORE_CONFLICT;
         }
         for(int j=0;j<i;j++)
            if(Tov2StorageSameLocator(staged[i].locator,staged[j].locator))
            {
               ClearEntries(staged);
               return TOV2_STORE_CONFLICT;
            }
      }
      SortEntries(staged,count);
      if(!OpsReady())
      {
         ClearEntries(staged);
         return TOV2_STORE_IO_ERROR;
      }
      int native_error=0;
      if(m_ops.ResizeEntries(entries,count,native_error)!=count || native_error!=0)
      {
         ClearEntries(entries);
         ClearEntries(staged);
         return TOV2_STORE_IO_ERROR;
      }
      for(int i=0;i<count;i++) entries[i]=staged[i];
      ClearEntries(staged);
      return TOV2_STORE_OK;
   }

   int Read(const string session_token,const Tov2StorageLocator &locator,
            uchar &bytes[])
   {
      bool caller_cleared=ClearBytes(bytes);
      if(!Tov2StorageLocatorValid(locator) || locator.kind==TOV2_LOC_OWNER)
         return TOV2_STORE_INVALID;
      int ownership=Revalidate(session_token);
      if(ownership!=TOV2_STORE_OK) return ownership;
      if(!caller_cleared) return TOV2_STORE_IO_ERROR;
      if(!OpsReady()) return TOV2_STORE_OWNERSHIP_LOST;
      string parent="",name="",path="";
      if(!LocatorPath(locator,parent,name,path)) return TOV2_STORE_INVALID;
      Tov2FileStoreProbe probe;
      int probed=ProbeChild(parent,name,true,probe);
      if(probed!=TOV2_STORE_OK) return probed;
      if(!probe.found) return TOV2_STORE_ABSENT;
      if(probe.directory || probe.size==0) return TOV2_STORE_CONFLICT;
      if(probe.size<0) return TOV2_STORE_IO_ERROR;
      if(probe.size>TOV2_RECORD_FRAME_MAX) return TOV2_STORE_LIMIT;

      int count=(int)probe.size;
      int native_error=0;
      int flags=FILE_BIN|FILE_READ;
      int handle=m_ops.OpenCommon(path,flags,native_error);
      if(handle==INVALID_HANDLE) return TOV2_STORE_IO_ERROR;
      if(native_error!=0)
      {
         CloseHandle(handle);
         return TOV2_STORE_IO_ERROR;
      }
      int result=TOV2_STORE_OK;
      long opened_size=m_ops.HandleInteger(handle,FILE_SIZE,native_error);
      if(native_error!=0 || opened_size!=probe.size) result=TOV2_STORE_IO_ERROR;
      uchar staged[];
      if(result==TOV2_STORE_OK &&
         (m_ops.ResizeBytes(staged,count,native_error)!=count || native_error!=0))
         result=TOV2_STORE_IO_ERROR;
      if(result==TOV2_STORE_OK)
      {
         int requested=count;
         uint read_count=m_ops.ReadBytes(handle,staged,0,requested,native_error);
         if(native_error!=0 || read_count!=(uint)requested) result=TOV2_STORE_IO_ERROR;
      }
      if(result==TOV2_STORE_OK)
      {
         long position=m_ops.HandleInteger(handle,FILE_POSITION,native_error);
         if(native_error!=0 || position!=probe.size) result=TOV2_STORE_IO_ERROR;
      }
      if(result==TOV2_STORE_OK)
      {
         long final_size=m_ops.HandleInteger(handle,FILE_SIZE,native_error);
         if(native_error!=0 || final_size!=probe.size) result=TOV2_STORE_IO_ERROR;
      }
      if(!CloseHandle(handle)) result=TOV2_STORE_IO_ERROR;
      if(result==TOV2_STORE_OK)
      {
         if(m_ops.ResizeBytes(bytes,count,native_error)!=count || native_error!=0 ||
            m_ops.CopyBytes(bytes,staged,0,0,count,native_error)!=count ||
            native_error!=0) result=TOV2_STORE_IO_ERROR;
      }
      if(result!=TOV2_STORE_OK) ClearBytes(bytes);
      return result;
   }

   int CreateExact(const string session_token,const Tov2StorageLocator &locator,
                   const uchar &bytes[])
   {
      int count=ArraySize(bytes);
      if(!Tov2StorageLocatorValid(locator) || locator.kind==TOV2_LOC_OWNER ||
         count<1 || count>TOV2_RECORD_FRAME_MAX) return TOV2_STORE_INVALID;
      if(!OpsReady()) return TOV2_STORE_IO_ERROR;
      int native_error=0;
      uchar requested_bytes[];
      if(m_ops.ResizeBytes(requested_bytes,count,native_error)!=count ||
         native_error!=0 ||
         m_ops.CopyBytes(requested_bytes,bytes,0,0,count,native_error)!=count ||
         native_error!=0)
      {
         int failed_ownership=Revalidate(session_token);
         if(failed_ownership!=TOV2_STORE_OK) return failed_ownership;
         return TOV2_STORE_IO_ERROR;
      }
      string requested_sha="";
      if(!m_ops.HashBytes(requested_bytes,requested_sha,native_error) ||
         native_error!=0 || !Tov2Digest(requested_sha))
      {
         int failed_ownership=Revalidate(session_token);
         if(failed_ownership!=TOV2_STORE_OK) return failed_ownership;
         return TOV2_STORE_IO_ERROR;
      }
      string record_kind="";
      long record_generation=0;
      uchar payload[];
      if(!Tov2RecordDecode(requested_bytes,record_kind,record_generation,payload) ||
         record_generation!=locator.generation) return TOV2_STORE_INVALID;

      int ownership=Revalidate(session_token);
      if(ownership!=TOV2_STORE_OK) return ownership;
      string parent="",name="",path="";
      if(!LocatorPath(locator,parent,name,path)) return TOV2_STORE_INVALID;
      Tov2FileStoreProbe probe;
      int probed=ProbeChild(parent,name,true,probe);
      if(probed!=TOV2_STORE_OK) return probed;
      if(probe.found)
      {
         if(probe.directory || probe.size<=0 ||
            probe.size>TOV2_RECORD_FRAME_MAX || probe.size!=count)
            return TOV2_STORE_CONFLICT;
         uchar existing[];
         if(ReadKnownFile(path,probe.size,existing)!=TOV2_STORE_OK)
            return TOV2_STORE_IO_ERROR;
         return BytesEqual(existing,requested_bytes) ? TOV2_STORE_EXISTS_SAME :
                                                       TOV2_STORE_CONFLICT;
      }

      int flags=FILE_BIN|FILE_READ|FILE_WRITE;
      int handle=m_ops.OpenCommon(path,flags,native_error);
      if(handle==INVALID_HANDLE) return TOV2_STORE_IO_ERROR;
      if(native_error!=0)
      {
         CloseHandle(handle);
         return TOV2_STORE_IO_ERROR;
      }
      long initial_size=m_ops.HandleInteger(handle,FILE_SIZE,native_error);
      if(native_error!=0 || initial_size!=0)
      {
         int refusal=(native_error==0 ? TOV2_STORE_CONFLICT :
                                        TOV2_STORE_IO_ERROR);
         if(!CloseHandle(handle)) refusal=TOV2_STORE_IO_ERROR;
         return refusal;
      }
      int result=TOV2_STORE_CREATED;
      int requested=count;
      uint written=m_ops.WriteBytes(handle,requested_bytes,0,requested,native_error);
      if(native_error!=0 || written!=(uint)requested) result=TOV2_STORE_IO_ERROR;
      if(result==TOV2_STORE_CREATED)
      {
         long position=m_ops.HandleInteger(handle,FILE_POSITION,native_error);
         if(native_error!=0 || position!=count) result=TOV2_STORE_IO_ERROR;
      }
      if(result==TOV2_STORE_CREATED)
      {
         long final_size=m_ops.HandleInteger(handle,FILE_SIZE,native_error);
         if(native_error!=0 || final_size!=count) result=TOV2_STORE_IO_ERROR;
      }
      if(result==TOV2_STORE_CREATED &&
         (!m_ops.Flush(handle,native_error) || native_error!=0))
         result=TOV2_STORE_IO_ERROR;
      if(!CloseHandle(handle)) result=TOV2_STORE_IO_ERROR;
      if(result!=TOV2_STORE_CREATED) return TOV2_STORE_IO_ERROR;
      uchar verified[];
      if(ReadKnownFile(path,count,verified)!=TOV2_STORE_OK ||
         !BytesEqual(verified,requested_bytes)) return TOV2_STORE_IO_ERROR;
      return TOV2_STORE_CREATED;
   }

   int DeleteExact(const string session_token,const Tov2StorageLocator &locator,
                   const string expected_sha)
   {
      if(!Tov2StorageLocatorValid(locator) ||
         locator.kind==TOV2_LOC_OWNER ||
         locator.kind==TOV2_LOC_REGISTRATION ||
         !Tov2Digest(expected_sha)) return TOV2_STORE_INVALID;
      int ownership=Revalidate(session_token);
      if(ownership!=TOV2_STORE_OK) return ownership;
      if(!OpsReady()) return TOV2_STORE_OWNERSHIP_LOST;
      string parent="",name="",path="";
      if(!LocatorPath(locator,parent,name,path)) return TOV2_STORE_INVALID;
      Tov2FileStoreProbe probe;
      int probed=ProbeChild(parent,name,true,probe);
      if(probed!=TOV2_STORE_OK) return probed;
      if(!probe.found) return TOV2_STORE_ABSENT;
      if(probe.directory || probe.size==0) return TOV2_STORE_CONFLICT;
      if(probe.size<0) return TOV2_STORE_IO_ERROR;
      if(probe.size>TOV2_RECORD_FRAME_MAX) return TOV2_STORE_LIMIT;
      uchar existing[];
      if(ReadKnownFile(path,probe.size,existing)!=TOV2_STORE_OK)
         return TOV2_STORE_IO_ERROR;
      int native_error=0;
      string actual_sha="";
      if(!m_ops.HashBytes(existing,actual_sha,native_error) || native_error!=0 ||
         !Tov2Digest(actual_sha)) return TOV2_STORE_IO_ERROR;
      if(actual_sha!=expected_sha) return TOV2_STORE_CONFLICT;
      if(!m_ops.DeleteFileCommon(path,native_error) || native_error!=0)
         return TOV2_STORE_IO_ERROR;
      Tov2FileStoreProbe after;
      int checked=ProbeChild(parent,name,true,after);
      if(checked!=TOV2_STORE_OK || after.found) return TOV2_STORE_IO_ERROR;
      return TOV2_STORE_DELETED;
   }

   void Close(const string session_token)
   {
      if(!SessionMatches(session_token)) return;
      int held=m_owner_handle;
      m_session_token="";
      m_installation_key="";
      m_root="";
      m_owner_handle=INVALID_HANDLE;
      CloseHandle(held);
   }
};

#endif
