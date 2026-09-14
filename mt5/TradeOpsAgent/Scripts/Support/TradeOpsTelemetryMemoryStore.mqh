#ifndef TRADEOPS_TELEMETRY_MEMORY_STORE_MQH
#define TRADEOPS_TELEMETRY_MEMORY_STORE_MQH
#include "../../Include/TradeOpsTelemetryStorage.mqh"

const int TOV2_MEMORY_FAULT_NONE=0;
const int TOV2_MEMORY_FAULT_BEFORE=1;
const int TOV2_MEMORY_FAULT_AFTER=2;

class CTov2TelemetryMemoryStore : public ITov2TelemetryStorage
{
private:
   int m_kind[];
   long m_generation[];
   long m_ordinal[];
   int m_offset[];
   int m_length[];
   bool m_deleted[];
   uchar m_arena[];
   int m_record_count;
   int m_arena_count;
   string m_installation_key;
   string m_owner_token;
   long m_session_serial;
   string m_fault_operation;
   int m_fault_occurrence;
   int m_fault_seen;
   int m_fault_mode;
   int m_delete_log_kind[];
   long m_delete_log_generation[];
   long m_delete_log_ordinal[];
   int m_delete_log_count;
   string m_internal_fault_operation;
   int m_internal_fault_occurrence;
   int m_internal_fault_seen;
   string m_outcome_operation;
   int m_outcome_occurrence;
   int m_outcome_seen;
   int m_outcome_result;

   bool Session(const string token)
   {
      return token!="" && token==m_owner_token;
   }

   bool Fault(const string operation,const int boundary)
   {
      if(m_fault_mode!=boundary ||
         (m_fault_operation!="ANY" && m_fault_operation!=operation)) return false;
      m_fault_seen++;
      if(m_fault_seen!=m_fault_occurrence) return false;
      m_fault_mode=TOV2_MEMORY_FAULT_NONE;
      return true;
   }

   bool InternalFault(const string operation)
   {
      if(m_internal_fault_operation!=operation) return false;
      m_internal_fault_seen++;
      return m_internal_fault_seen==m_internal_fault_occurrence;
   }

   bool ForcedOutcome(const string operation,int &result)
   {
      if(m_outcome_operation!=operation) return false;
      m_outcome_seen++;
      if(m_outcome_seen!=m_outcome_occurrence) return false;
      result=m_outcome_result;
      return true;
   }

   int Find(const Tov2StorageLocator &locator)
   {
      for(int i=m_record_count-1;i>=0;i--)
         if(!m_deleted[i] && m_kind[i]==locator.kind &&
            m_generation[i]==locator.generation && m_ordinal[i]==locator.ordinal)
            return i;
      return -1;
   }

   bool SegmentEqual(const int index,const uchar &bytes[])
   {
      int count=ArraySize(bytes);
      if(index<0 || m_length[index]!=count) return false;
      for(int i=0;i<count;i++)
         if(m_arena[m_offset[index]+i]!=bytes[i]) return false;
      return true;
   }

   bool AppendRecord(const Tov2StorageLocator &locator,const uchar &bytes[])
   {
      int old_count=m_record_count;
      int old_bytes=m_arena_count;
      int count=ArraySize(bytes);
      if(count<1 || count>TOV2_RECORD_FRAME_MAX ||
         ArrayResize(m_kind,old_count+1)!=old_count+1 ||
         InternalFault("ALLOC_RECORD") ||
         ArrayResize(m_generation,old_count+1)!=old_count+1 ||
         ArrayResize(m_ordinal,old_count+1)!=old_count+1 ||
         ArrayResize(m_offset,old_count+1)!=old_count+1 ||
         ArrayResize(m_length,old_count+1)!=old_count+1 ||
         ArrayResize(m_deleted,old_count+1)!=old_count+1 ||
         ArrayResize(m_arena,old_bytes+count)!=old_bytes+count ||
         InternalFault("COPY_RECORD") ||
         ArrayCopy(m_arena,bytes,old_bytes,0,count)!=count) return false;
      m_kind[old_count]=locator.kind;
      m_generation[old_count]=locator.generation;
      m_ordinal[old_count]=locator.ordinal;
      m_offset[old_count]=old_bytes;
      m_length[old_count]=count;
      m_deleted[old_count]=false;
      m_arena_count=old_bytes+count;
      m_record_count=old_count+1;
      return true;
   }

public:
   CTov2TelemetryMemoryStore()
   {
      m_owner_token="";
      m_installation_key="";
      m_session_serial=0;
      m_fault_operation="";
      m_fault_occurrence=0;
      m_fault_seen=0;
      m_fault_mode=TOV2_MEMORY_FAULT_NONE;
      m_record_count=0;
      m_arena_count=0;
      m_delete_log_count=0;
      m_internal_fault_operation="";
      m_internal_fault_occurrence=0;
      m_internal_fault_seen=0;
      m_outcome_operation="";
      m_outcome_occurrence=0;
      m_outcome_seen=0;
      m_outcome_result=TOV2_STORE_IO_ERROR;
   }

   void ArmFault(const string operation,const int occurrence,const int mode)
   {
      m_fault_operation=operation;
      m_fault_occurrence=occurrence;
      m_fault_seen=0;
      m_fault_mode=mode;
   }

   void ClearFault()
   {
      m_fault_operation="";
      m_fault_occurrence=0;
      m_fault_seen=0;
      m_fault_mode=TOV2_MEMORY_FAULT_NONE;
   }

   // Test-only observability: callers use a high non-firing occurrence to
   // measure the exact path, then assert the selected occurrence fired.
   int FaultSeen() { return m_fault_seen; }
   bool FaultTriggered()
   {
      return m_fault_occurrence>0 && m_fault_seen==m_fault_occurrence &&
             m_fault_mode==TOV2_MEMORY_FAULT_NONE;
   }

   void ArmInternalFault(const string operation,const int occurrence)
   {
      m_internal_fault_operation=operation;
      m_internal_fault_occurrence=occurrence;
      m_internal_fault_seen=0;
   }

   void ClearInternalFault()
   {
      m_internal_fault_operation="";
      m_internal_fault_occurrence=0;
      m_internal_fault_seen=0;
   }

   void ArmOutcome(const string operation,const int occurrence,const int result)
   {
      m_outcome_operation=operation;
      m_outcome_occurrence=occurrence;
      m_outcome_seen=0;
      m_outcome_result=result;
   }

   void ClearOutcome()
   {
      m_outcome_operation="";
      m_outcome_occurrence=0;
      m_outcome_seen=0;
      m_outcome_result=TOV2_STORE_IO_ERROR;
   }

   void Crash()
   {
      m_owner_token="";
      ClearFault();
      ClearInternalFault();
      ClearOutcome();
   }

   int PersistentCount()
   {
      int count=0;
      for(int i=0;i<m_record_count;i++) if(!m_deleted[i]) count++;
      return count;
   }

   int Acquire(const string installation_key,string &session_token)
   {
      session_token="";
      if(!Tov2Digest(installation_key)) return TOV2_STORE_INVALID;
      if(Fault("ACQUIRE",TOV2_MEMORY_FAULT_BEFORE)) return TOV2_STORE_IO_ERROR;
      if(m_installation_key!="" && m_installation_key!=installation_key)
         return TOV2_STORE_CONFLICT;
      if(m_owner_token!="") return TOV2_STORE_BUSY;
      if(m_installation_key=="") m_installation_key=installation_key;
      m_session_serial++;
      m_owner_token="memory.session."+Tov2LocalNumber(m_session_serial);
      session_token=m_owner_token;
      if(Fault("ACQUIRE",TOV2_MEMORY_FAULT_AFTER))
      {
         m_owner_token="";
         session_token="";
         return TOV2_STORE_IO_ERROR;
      }
      return TOV2_STORE_ACQUIRED;
   }

   int Revalidate(const string session_token)
   {
      if(Fault("REVALIDATE",TOV2_MEMORY_FAULT_BEFORE)) return TOV2_STORE_IO_ERROR;
      if(!Session(session_token)) return TOV2_STORE_OWNERSHIP_LOST;
      if(Fault("REVALIDATE",TOV2_MEMORY_FAULT_AFTER))
      {
         m_owner_token="";
         return TOV2_STORE_IO_ERROR;
      }
      return TOV2_STORE_OK;
   }

   int Inventory(const string session_token,Tov2StorageEntry &entries[])
   {
      ArrayResize(entries,0);
      if(Fault("INVENTORY",TOV2_MEMORY_FAULT_BEFORE)) return TOV2_STORE_IO_ERROR;
      if(!Session(session_token)) return TOV2_STORE_OWNERSHIP_LOST;
      int count=PersistentCount();
      if(count>TOV2_STORAGE_INVENTORY_MAX) return TOV2_STORE_LIMIT;
      if(count==0)
      {
         if(Fault("INVENTORY",TOV2_MEMORY_FAULT_AFTER)) return TOV2_STORE_IO_ERROR;
         return TOV2_STORE_ABSENT;
      }
      if(ArrayResize(entries,count)!=count)
      {
         ArrayResize(entries,0);
         return TOV2_STORE_IO_ERROR;
      }
      int out=0;
      for(int i=0;i<m_record_count;i++)
      {
         if(m_deleted[i]) continue;
         entries[out].locator.kind=m_kind[i];
         entries[out].locator.generation=m_generation[i];
         entries[out].locator.ordinal=m_ordinal[i];
         entries[out].relative_path=Tov2StorageRelativePath(entries[out].locator);
         entries[out].size=m_length[i];
         if(m_kind[i]==TOV2_LOC_OWNER) entries[out].sha="-";
         else
         {
            uchar value[];
            if(ArrayResize(value,m_length[i])!=m_length[i] ||
               ArrayCopy(value,m_arena,0,m_offset[i],m_length[i])!=m_length[i] ||
               !Tov2LocalHash(value,entries[out].sha))
            {
               ArrayResize(entries,0);
               return TOV2_STORE_IO_ERROR;
            }
         }
         out++;
      }
      if(Fault("INVENTORY",TOV2_MEMORY_FAULT_AFTER))
      {
         ArrayResize(entries,0);
         return TOV2_STORE_IO_ERROR;
      }
      return TOV2_STORE_OK;
   }

   int Read(const string session_token,const Tov2StorageLocator &locator,
            uchar &bytes[])
   {
      ArrayResize(bytes,0);
      if(!Tov2StorageLocatorValid(locator) || locator.kind==TOV2_LOC_OWNER)
         return TOV2_STORE_INVALID;
      if(Fault("READ",TOV2_MEMORY_FAULT_BEFORE)) return TOV2_STORE_IO_ERROR;
      if(!Session(session_token)) return TOV2_STORE_OWNERSHIP_LOST;
      int index=Find(locator);
      if(index<0) return TOV2_STORE_ABSENT;
      int count=m_length[index];
      if(ArrayResize(bytes,count)!=count ||
         ArrayCopy(bytes,m_arena,0,m_offset[index],count)!=count)
      {
         ArrayResize(bytes,0);
         return TOV2_STORE_IO_ERROR;
      }
      if(Fault("READ",TOV2_MEMORY_FAULT_AFTER))
      {
         ArrayResize(bytes,0);
         return TOV2_STORE_IO_ERROR;
      }
      return TOV2_STORE_OK;
   }

   int CreateExact(const string session_token,const Tov2StorageLocator &locator,
                   const uchar &bytes[])
   {
      if(!Tov2StorageLocatorValid(locator) || locator.kind==TOV2_LOC_OWNER ||
         ArraySize(bytes)<1 || ArraySize(bytes)>TOV2_RECORD_FRAME_MAX)
         return TOV2_STORE_INVALID;
      if(Fault("CREATE",TOV2_MEMORY_FAULT_BEFORE)) return TOV2_STORE_IO_ERROR;
      if(!Session(session_token)) return TOV2_STORE_OWNERSHIP_LOST;
      int forced=TOV2_STORE_IO_ERROR;
      if(ForcedOutcome("CREATE",forced)) return forced;
      int index=Find(locator);
      if(index>=0)
         return SegmentEqual(index,bytes) ? TOV2_STORE_EXISTS_SAME : TOV2_STORE_CONFLICT;
      if(!AppendRecord(locator,bytes)) return TOV2_STORE_IO_ERROR;
      if(Fault("CREATE",TOV2_MEMORY_FAULT_AFTER)) return TOV2_STORE_IO_ERROR;
      return TOV2_STORE_CREATED;
   }

   int DeleteExact(const string session_token,const Tov2StorageLocator &locator,
                   const string expected_sha)
   {
      if(!Tov2StorageLocatorValid(locator) || locator.kind==TOV2_LOC_OWNER ||
         !Tov2Digest(expected_sha)) return TOV2_STORE_INVALID;
      if(Fault("DELETE",TOV2_MEMORY_FAULT_BEFORE)) return TOV2_STORE_IO_ERROR;
      if(!Session(session_token)) return TOV2_STORE_OWNERSHIP_LOST;
      int forced=TOV2_STORE_IO_ERROR;
      if(ForcedOutcome("DELETE",forced)) return forced;
      int log_count=m_delete_log_count;
      if(ArrayResize(m_delete_log_kind,log_count+1)!=log_count+1 ||
         InternalFault("ALLOC_LOG") ||
         ArrayResize(m_delete_log_generation,log_count+1)!=log_count+1 ||
         ArrayResize(m_delete_log_ordinal,log_count+1)!=log_count+1)
         return TOV2_STORE_IO_ERROR;
      m_delete_log_kind[log_count]=locator.kind;
      m_delete_log_generation[log_count]=locator.generation;
      m_delete_log_ordinal[log_count]=locator.ordinal;
      m_delete_log_count=log_count+1;
      int index=Find(locator);
      if(index<0) return TOV2_STORE_ABSENT;
      uchar value[]; string actual="";
      if(ArrayResize(value,m_length[index])!=m_length[index] ||
         ArrayCopy(value,m_arena,0,m_offset[index],m_length[index])!=m_length[index] ||
         !Tov2LocalHash(value,actual)) return TOV2_STORE_IO_ERROR;
      if(actual!=expected_sha) return TOV2_STORE_CONFLICT;
      m_deleted[index]=true;
      if(Fault("DELETE",TOV2_MEMORY_FAULT_AFTER)) return TOV2_STORE_IO_ERROR;
      return TOV2_STORE_DELETED;
   }

   void Close(const string session_token)
   {
      if(Session(session_token)) m_owner_token="";
   }

   bool Corrupt(const Tov2StorageLocator &locator,const int byte_index)
   {
      int index=Find(locator);
      if(index<0 || byte_index<0 || byte_index>=m_length[index]) return false;
      m_arena[m_offset[index]+byte_index]^=1;
      return true;
   }

   bool Remove(const Tov2StorageLocator &locator)
   {
      int index=Find(locator);
      if(index<0) return false;
      m_deleted[index]=true;
      return true;
   }

   bool Inject(const Tov2StorageLocator &locator,const uchar &bytes[])
   {
      if(!Tov2StorageLocatorValid(locator) || Find(locator)>=0) return false;
      return AppendRecord(locator,bytes);
   }

   bool Exists(const Tov2StorageLocator &locator)
   {
      return Find(locator)>=0;
   }

   bool Copy(const Tov2StorageLocator &locator,uchar &bytes[])
   {
      ArrayResize(bytes,0);
      int index=Find(locator);
      if(index<0) return false;
      return ArrayResize(bytes,m_length[index])==m_length[index] &&
             ArrayCopy(bytes,m_arena,0,m_offset[index],m_length[index])==m_length[index];
   }

   void ClearDeleteLog()
   {
      m_delete_log_count=0;
   }

   int RecordCount() { return m_record_count; }
   int DeleteLogCount() { return m_delete_log_count; }
   int DeleteLogKind(const int index)
   {
      return index>=0 && index<m_delete_log_count ? m_delete_log_kind[index] : 0;
   }
   long DeleteLogGeneration(const int index)
   {
      return index>=0 && index<m_delete_log_count ?
             m_delete_log_generation[index] : 0;
   }
   long DeleteLogOrdinal(const int index)
   {
      return index>=0 && index<m_delete_log_count ?
             m_delete_log_ordinal[index] : 0;
   }
};

#endif
