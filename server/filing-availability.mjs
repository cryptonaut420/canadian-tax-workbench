import {ApiError} from './model.mjs';

// CRA's published 2026 NETFILE/ReFILE season. Keep this explicit rather than
// guessing availability from whether a legacy DLL has a RefileXML method.
export function filingAvailability(year,mode){
 const supported=mode==='netfile'?year>=2019&&year<=2025:mode==='refile'&&year>=2022&&year<=2025;
 return {year,mode,supported,season:2026,requiresAssessment:mode==='refile',alternative:mode==='refile'&&!supported?'CRA Change my return or T1-ADJ':null,
  message:supported?(mode==='refile'?'ReFILE is available for this year. Wait for CRA to assess the original return before requesting an amendment.':'Initial return: NETFILE.'):mode==='refile'?`ReFILE is not available for ${year} in the current CRA filing season. Do not submit another NETFILE return. Use CRA Change my return or T1-ADJ after assessment.`:'This tax year is outside the supported NETFILE filing years.'};
}
export function assertFilingAvailable(year,mode){const availability=filingAvailability(year,mode);if(!availability.supported)throw new ApiError(422,availability.message);return availability;}
