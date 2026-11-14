import {ApiError,summary} from './model.mjs';
import {filingAvailability} from './filing-availability.mjs';
import {financialDifferences} from './snapshot.mjs';

export function amendmentReview(store,id){
 const item=store.get(id),accepted=item.filing.lastAccepted;
 if(!accepted)throw new ApiError(409,'This workspace has no accepted snapshot to compare. Preserve the original accepted request for an amendment filed elsewhere.');
 const base=store.calculation(accepted.calculationId);
 if(!base)throw new ApiError(409,'The accepted calculation snapshot is unavailable. Recover the original filing records before preparing an amendment.');
 const revision=store.db.prepare('SELECT fields FROM revisions WHERE return_id=? AND revision=?').get(id,accepted.inputRevision);
 const original=revision?JSON.parse(revision.fields):null;
 const changes=original?financialDifferences(original,item.fields):[];
 return {returnId:id,year:item.year,inputRevision:item.revision,calculationId:item.calculation?.id??null,calculationCurrent:item.calculation?.inputRevision===item.revision,
  accepted:{inputRevision:accepted.inputRevision,calculationId:accepted.calculationId,confirmationNumber:accepted.confirmationNumber,completedAt:accepted.completedAt},
  availability:filingAvailability(item.year,'refile'),sourceChanges:changes,
  spouseNetIncome:{field:'SPOUS:00051:C',filed:original?.['SPOUS:00051:C']??null,current:item.fields['SPOUS:00051:C']??null},
  filedTotals:summary(base.result),currentTotals:item.calculation?summary(item.calculation.result):null,
  note:'This compares the latest saved preparation with the immutable accepted snapshot. An unchanged tax balance does not mean spouse-income changes can be ignored. No request is sent by this comparison.'};
}
