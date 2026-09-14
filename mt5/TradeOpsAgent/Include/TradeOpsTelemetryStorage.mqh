#ifndef TRADEOPS_TELEMETRY_STORAGE_MQH
#define TRADEOPS_TELEMETRY_STORAGE_MQH
#include "TradeOpsTelemetryStorageCodec.mqh"

const long TOV2_STORAGE_NORMAL_BYTES=67108864;
const long TOV2_STORAGE_RESERVE_BYTES=8388608;
const int TOV2_STORAGE_NORMAL_FILES=4096;
const int TOV2_STORAGE_RESERVE_FILES=128;
const int TOV2_STORAGE_DELETE_BATCH=32;
const int TOV2_STORAGE_INVENTORY_MAX=4225;

const int TOV2_LOC_OWNER=1;
const int TOV2_LOC_REGISTRATION=2;
const int TOV2_LOC_OBJECT=3;
const int TOV2_LOC_STATE=4;
const int TOV2_LOC_COMMIT=5;

const int TOV2_STORE_OK=0;
const int TOV2_STORE_ABSENT=1;
const int TOV2_STORE_ACQUIRED=2;
const int TOV2_STORE_BUSY=3;
const int TOV2_STORE_CREATED=4;
const int TOV2_STORE_EXISTS_SAME=5;
const int TOV2_STORE_DELETED=6;
const int TOV2_STORE_CONFLICT=7;
const int TOV2_STORE_IO_ERROR=8;
const int TOV2_STORE_OWNERSHIP_LOST=9;
const int TOV2_STORE_LIMIT=10;
const int TOV2_STORE_INVALID=11;

struct Tov2StorageLocator
{
   int kind;
   long generation;
   long ordinal;
};

void Tov2StorageClearLocator(Tov2StorageLocator &locator)
{
   locator.kind=0;
   locator.generation=0;
   locator.ordinal=0;
}

bool Tov2StorageLocatorValid(const Tov2StorageLocator &locator)
{
   if(locator.kind==TOV2_LOC_OWNER)
      return locator.generation==0 && locator.ordinal==0;
   if(locator.kind==TOV2_LOC_REGISTRATION)
      return locator.generation==1 && locator.ordinal==0;
   if(locator.kind==TOV2_LOC_STATE || locator.kind==TOV2_LOC_COMMIT)
      return Tov2Counter(locator.generation,1) && locator.ordinal==0;
   if(locator.kind==TOV2_LOC_OBJECT)
      return Tov2Counter(locator.generation,1) && Tov2Counter(locator.ordinal,1);
   return false;
}

bool Tov2StorageSameLocator(const Tov2StorageLocator &left,
                            const Tov2StorageLocator &right)
{
   return left.kind==right.kind && left.generation==right.generation &&
          left.ordinal==right.ordinal;
}

Tov2StorageLocator Tov2StorageOwnerLocator()
{
   Tov2StorageLocator result;
   result.kind=TOV2_LOC_OWNER; result.generation=0; result.ordinal=0;
   return result;
}

Tov2StorageLocator Tov2StorageRegistrationLocator()
{
   Tov2StorageLocator result;
   result.kind=TOV2_LOC_REGISTRATION; result.generation=1; result.ordinal=0;
   return result;
}

Tov2StorageLocator Tov2StorageObjectLocator(const long generation,const long ordinal)
{
   Tov2StorageLocator result;
   result.kind=TOV2_LOC_OBJECT; result.generation=generation; result.ordinal=ordinal;
   return result;
}

Tov2StorageLocator Tov2StorageStateLocator(const long generation)
{
   Tov2StorageLocator result;
   result.kind=TOV2_LOC_STATE; result.generation=generation; result.ordinal=0;
   return result;
}

Tov2StorageLocator Tov2StorageCommitLocator(const long generation)
{
   Tov2StorageLocator result;
   result.kind=TOV2_LOC_COMMIT; result.generation=generation; result.ordinal=0;
   return result;
}

string Tov2StorageRelativePath(const Tov2StorageLocator &locator)
{
   if(!Tov2StorageLocatorValid(locator)) return "";
   if(locator.kind==TOV2_LOC_OWNER) return "owner.lock";
   if(locator.kind==TOV2_LOC_REGISTRATION) return "registration.rec";
   if(locator.kind==TOV2_LOC_STATE)
      return "states/"+Tov2LocalNumber(locator.generation)+".rec";
   if(locator.kind==TOV2_LOC_COMMIT)
      return "commits/"+Tov2LocalNumber(locator.generation)+".rec";
   return "objects/"+Tov2LocalNumber(locator.generation)+"-"+
          Tov2LocalNumber(locator.ordinal)+".rec";
}

struct Tov2StorageEntry
{
   Tov2StorageLocator locator;
   string relative_path;
   long size;
   string sha;
};

void Tov2StorageClearEntry(Tov2StorageEntry &entry)
{
   Tov2StorageClearLocator(entry.locator);
   entry.relative_path="";
   entry.size=0;
   entry.sha="-";
}

bool Tov2StorageEntryValid(const Tov2StorageEntry &entry)
{
   if(!Tov2StorageLocatorValid(entry.locator) || entry.size<0 ||
      entry.relative_path!=Tov2StorageRelativePath(entry.locator)) return false;
   if(entry.locator.kind==TOV2_LOC_OWNER)
      return entry.sha=="-";
   return Tov2Digest(entry.sha) && entry.size>=1 && entry.size<=TOV2_RECORD_FRAME_MAX;
}

bool Tov2StorageDefiniteRead(const int result)
{
   return result==TOV2_STORE_OK || result==TOV2_STORE_ABSENT;
}

bool Tov2StorageDefiniteCreate(const int result)
{
   return result==TOV2_STORE_CREATED || result==TOV2_STORE_EXISTS_SAME ||
          result==TOV2_STORE_CONFLICT;
}

bool Tov2StorageDefiniteDelete(const int result)
{
   return result==TOV2_STORE_DELETED || result==TOV2_STORE_ABSENT ||
          result==TOV2_STORE_CONFLICT;
}

bool Tov2StorageReserveTransition(const string transition)
{
   return transition=="ACK" || transition=="CHECKPOINT" ||
          transition=="DIAGNOSTIC";
}

bool Tov2StorageRuntimeTransition(const string transition)
{
   return transition=="INIT" || transition=="APPEND" ||
          transition=="CHECKPOINT" || transition=="DIAGNOSTIC" ||
          transition=="PREPARE" || transition=="ACK" || transition=="REPLACE";
}

bool Tov2StorageBudgetTransition(const string transition)
{
   return Tov2LocalTransition(transition);
}

bool Tov2StorageBudget(const Tov2StorageEntry &entries[],long &bytes,int &files,
                       long &highest_generation)
{
   bytes=0; files=0; highest_generation=0;
   int count=ArraySize(entries);
   if(count<0 || count>TOV2_STORAGE_INVENTORY_MAX) return false;
   for(int i=0;i<count;i++)
   {
      if(!Tov2StorageEntryValid(entries[i])) return false;
      for(int j=0;j<i;j++)
         if(Tov2StorageSameLocator(entries[i].locator,entries[j].locator) ||
            entries[i].relative_path==entries[j].relative_path) return false;
      if(entries[i].locator.kind==TOV2_LOC_OWNER)
      {
         if(entries[i].size!=0) return false;
         continue;
      }
      if(entries[i].size>TOV2_STORAGE_NORMAL_BYTES+TOV2_STORAGE_RESERVE_BYTES-bytes)
         return false;
      bytes+=entries[i].size;
      files++;
      if(entries[i].locator.generation>highest_generation)
         highest_generation=entries[i].locator.generation;
   }
   return files<=TOV2_STORAGE_NORMAL_FILES+TOV2_STORAGE_RESERVE_FILES;
}

bool Tov2StoragePreflight(const Tov2StorageEntry &entries[],const string transition,
                          const long added_bytes,const int added_files)
{
   if(!Tov2StorageBudgetTransition(transition) || added_bytes<0 || added_files<0)
      return false;
   long bytes=0,highest=0; int files=0;
   if(!Tov2StorageBudget(entries,bytes,files,highest)) return false;
   long byte_limit=TOV2_STORAGE_NORMAL_BYTES;
   int file_limit=TOV2_STORAGE_NORMAL_FILES;
   if(Tov2StorageReserveTransition(transition))
   {
      byte_limit+=TOV2_STORAGE_RESERVE_BYTES;
      file_limit+=TOV2_STORAGE_RESERVE_FILES;
   }
   if(added_bytes>byte_limit-bytes || added_files>file_limit-files) return false;
   return true;
}

class ITov2TelemetryStorage
{
public:
   virtual int Acquire(const string installation_key,string &session_token)=0;
   virtual int Revalidate(const string session_token)=0;
   virtual int Inventory(const string session_token,Tov2StorageEntry &entries[])=0;
   virtual int Read(const string session_token,const Tov2StorageLocator &locator,
                    uchar &bytes[])=0;
   virtual int CreateExact(const string session_token,const Tov2StorageLocator &locator,
                           const uchar &bytes[])=0;
   virtual int DeleteExact(const string session_token,const Tov2StorageLocator &locator,
                           const string expected_sha)=0;
   virtual void Close(const string session_token)=0;
};

#endif
