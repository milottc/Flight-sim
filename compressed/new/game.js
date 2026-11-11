try{const _gp=navigator.getGamepads;navigator.getGamepads=function(){try{return _gp.call(navigator)||[];}catch(e){return [];}};}catch(e){}
const errEl=document.getElementById('errorBanner'),bootEl=document.getElementById('bootBadge'),loadEl=document.getElementById('loadStatus');
const camBadge=document.getElementById('camBadge');
function fatal(m){console.error('[FATAL]',m);errEl.style.display='block';errEl.textContent='⚠ '+m;}
function status(m){bootEl.textContent='BOOT · '+m;}
window.addEventListener('error',e=>fatal(e.message+' @'+e.lineno));
window.addEventListener('unhandledrejection',e=>fatal('Promise: '+((e.reason&&e.reason.message)||e.reason)));
function loadJS(u){return new Promise(r=>{const t=document.createElement('script');t.src=u;t.onload=()=>r(true);t.onerror=()=>r(false);document.head.appendChild(t);});}
/* ===== OFFLINE CACHE (IndexedDB): map tiles, elevation tiles and the 3D engine libraries ===== */
const OFF=(()=>{
  const DB='bf737-offline',STORE='blobs';
  const keys=new Set();let dbP=null,initP=null;
  const LIBS=[
    ['lib/babylon.js',['https://cdn.jsdelivr.net/npm/babylonjs@7/babylon.js','https://unpkg.com/babylonjs@7/babylon.js','https://cdnjs.cloudflare.com/ajax/libs/babylonjs/7.31.0/babylon.js']],
    ['lib/babylonjs.materials.min.js',['https://cdn.jsdelivr.net/npm/babylonjs-materials@7/babylonjs.materials.min.js','https://unpkg.com/babylonjs-materials@7/babylonjs.materials.min.js','https://cdnjs.cloudflare.com/ajax/libs/babylonjs/7.31.0/babylonjs.materials.min.js']]
  ];
  const openDB=()=>dbP||(dbP=new Promise((res,rej)=>{
    if(!self.indexedDB){rej(new Error('no IndexedDB'));return;}
    const r=indexedDB.open(DB,1);
    r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE);};
    r.onsuccess=()=>res(r.result);r.onerror=()=>{dbP=null;rej(r.error);};
  }));
  const req=(mode,fn)=>openDB().then(db=>new Promise((res,rej)=>{
    const t=db.transaction(STORE,mode);const q=fn(t.objectStore(STORE));
    t.oncomplete=()=>res(q.result);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error);
  }));
  const init=()=>initP||(initP=req('readonly',s=>s.getAllKeys()).then(ks=>{ks.forEach(k=>keys.add(k));return keys.size;}).catch(()=>0));
  const getBlob=k=>req('readonly',s=>s.get(k)).then(b=>b||null).catch(()=>null);
  const put=(k,b)=>req('readwrite',s=>s.put(b,k)).then(()=>{keys.add(k);});
  const fetchBlob=async u=>{const c=new AbortController(),t=setTimeout(()=>c.abort(),20000);
    try{const r=await fetch(u,{signal:c.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.blob();}
    finally{clearTimeout(t);}};
  return {
    init,put,fetchBlob,
    has:k=>keys.has(k),
    count:()=>keys.size,
    /* offline copy if one is stored, otherwise the network URL */
    async srcFor(offKey,url){
      if(offKey&&keys.has(offKey)){const b=await getBlob(offKey);if(b)return URL.createObjectURL(b);}
      return url;
    },
    async downloadLibs(){
      let n=0;await init();
      for(const [k,urls] of LIBS){
        if(keys.has(k))continue;
        for(const u of urls){try{await put(k,await fetchBlob(u));n++;break;}catch(e){}}
      }
      return n;
    },
    async loadLibs(){
      await init();
      for(const [k] of LIBS){const b=await getBlob(k);if(!b)return false;if(!(await loadJS(URL.createObjectURL(b))))return false;}
      return typeof BABYLON!=='undefined';
    }
  };
})();

(async()=>{
  if(typeof BABYLON==='undefined'){
    const mirrors=[
      ['https://cdn.jsdelivr.net/npm/babylonjs@7/babylon.js','https://cdn.jsdelivr.net/npm/babylonjs-materials@7/babylonjs.materials.min.js'],
      ['https://unpkg.com/babylonjs@7/babylon.js','https://unpkg.com/babylonjs-materials@7/babylonjs.materials.min.js'],
      ['https://cdnjs.cloudflare.com/ajax/libs/babylonjs/7.31.0/babylon.js','https://cdnjs.cloudflare.com/ajax/libs/babylonjs/7.31.0/babylonjs.materials.min.js']];
    for(const [a,b] of mirrors){bootEl.textContent='BOOT · loading engine…';if(await loadJS(a)&&typeof BABYLON!=='undefined'){await loadJS(b);break;}}
  }
  if(typeof BABYLON==='undefined'){await OFF.loadLibs();}
  if(typeof BABYLON==='undefined'){fatal('Babylon.js failed to load from every CDN. Check your internet connection.');return;}
  await OFF.init();
  try{main();}catch(e){fatal('Startup: '+e.message);console.error(e);}
})();

function main(){
let _sfxCur=null;

/* ===== SETTINGS (persisted in localStorage) ===== */
const SET_DEF={rudder:'simple',purple:false};
const SET=(()=>{try{return Object.assign({},SET_DEF,JSON.parse(localStorage.getItem('bf737_settings')||'{}'));}catch(e){return Object.assign({},SET_DEF);}})();
const saveSet=()=>{try{localStorage.setItem('bf737_settings',JSON.stringify(SET));}catch(e){}};

/* ===== KSFO: real FAA threshold coordinates for all four runways (source: AirNav/FAA). World origin = centre of 28L/10R so the
   satellite imagery's real runways line up exactly with the simulated ones. True headings (magnetic variation 14E). ===== */
const KS_REF={lat:37.619002,lon:-122.375727};
const ksXZ=(la,lo)=>[(lo-KS_REF.lon)*111320*Math.cos(KS_REF.lat*Math.PI/180),-(la-KS_REF.lat)*111132];
const KS_RWY=[
  {des:['28L','10R'],a:[37.611712,-122.358349],b:[37.626291,-122.393105],appr:[1,0]},
  {des:['28R','10L'],a:[37.613534,-122.357141],b:[37.628739,-122.393392],appr:[1,0]},
  {des:['1R','19L'],a:[37.606330,-122.381041],b:[37.627342,-122.367111],appr:[0,0]},
  {des:['1L','19R'],a:[37.607898,-122.382929],b:[37.626481,-122.370609],appr:[1,0]}
].map(r=>{const A=ksXZ(...r.a),B=ksXZ(...r.b),dx=B[0]-A[0],dz=B[1]-A[1],len=Math.hypot(dx,dz);
  return Object.assign(r,{A,B,len,wid:61,cx:(A[0]+B[0])/2,cz:(A[1]+B[1])/2,hdg:(Math.atan2(dx,-dz)*180/Math.PI+360)%360,ux:dx/len,uz:dz/len});});
/* runway-local helper: world [x,z] of the point s metres along the runway from its first threshold and o metres to the LEFT of its heading
   (x is east, z is south, so "left" = (uz,-ux)) */
const ksAt=(r,s,o)=>[r.A[0]+r.ux*s+r.uz*o, r.A[1]+r.uz*s-r.ux*o];
const KS_TERM=ksXZ(37.6160,-122.3892);   /* centre of the terminal horseshoe / central garage */
const KS_FIELD=ksXZ(37.6165,-122.3790);  /* middle of the airfield, between the terminals and the 1L/1R runways */

const LOCS={
  // North America — Canada — Ontario
  CYYZ:{lat:43.6772,lon:-79.6306,elev:173},  // Toronto Pearson
  CYTZ:{lat:43.6275,lon:-79.3962,elev:77},   // Toronto Billy Bishop (Island)
  CYKF:{lat:43.4608,lon:-80.3786,elev:321},  // Waterloo
  CYOO:{lat:43.9228,lon:-78.8950,elev:137},  // Oshawa
  CYHM:{lat:43.1736,lon:-79.9350,elev:238},  // Hamilton
  CYKZ:{lat:43.8608,lon:-79.3703,elev:190},  // Buttonville (Toronto north)
  CYXU:{lat:43.0356,lon:-81.1531,elev:278},  // London ON
  CYWG:{lat:49.9100,lon:-97.2398,elev:239},  // Winnipeg
  // Canada — Quebec
  CYUL:{lat:45.4706,lon:-73.7408,elev:36},   // Montréal Trudeau
  CYMX:{lat:45.6795,lon:-74.0056,elev:57},   // Montréal Mirabel
  CYHU:{lat:45.5175,lon:-73.4197,elev:27},   // St-Hubert (Longueuil)
  CYQB:{lat:46.7911,lon:-71.3933,elev:74},   // Quebec City
  CYSB:{lat:46.6253,lon:-80.7989,elev:348},  // Sudbury
  // Canada — BC / West
  CYVR:{lat:49.1947,lon:-123.1792,elev:4},   // Vancouver Intl
  CYYJ:{lat:48.6469,lon:-123.4258,elev:19},  // Victoria
  CZBB:{lat:49.0942,lon:-122.3597,elev:2},   // Boundary Bay (Delta BC)
  CYCD:{lat:49.0547,lon:-123.8697,elev:6},   // Nanaimo
  CYXS:{lat:53.8894,lon:-122.6792,elev:691}, // Prince George
  CYXX:{lat:49.0253,lon:-122.3606,elev:58},  // Abbotsford
  // Canada — Alberta / Prairies
  CYYC:{lat:51.1139,lon:-114.0203,elev:1084},// Calgary Intl
  CYBW:{lat:51.1131,lon:-114.3744,elev:1118},// Springbank (Calgary area)
  CYEG:{lat:53.3097,lon:-113.5800,elev:723}, // Edmonton Intl
  CYXD:{lat:53.5728,lon:-113.5214,elev:671}, // Edmonton City Centre (Blatchford)
  CYXE:{lat:52.1333,lon:-106.6667,elev:480}, // Saskatoon
  CYQR:{lat:50.4319,lon:-104.6177,elev:577}, // Regina
  CYBR:{lat:49.9108,lon:-99.9519,elev:357},  // Brandon
  // Canada — East / Maritimes
  CYOW:{lat:45.3225,lon:-75.6692,elev:114},  // Ottawa
  CYYG:{lat:46.2900,lon:-63.1211,elev:55},   // Charlottetown
  CYHZ:{lat:44.8808,lon:-63.5086,elev:145},  // Halifax
  CYQM:{lat:46.1122,lon:-64.6786,elev:71},   // Moncton
  CYFC:{lat:45.8719,lon:-66.5372,elev:34},   // Fredericton
  CYSJ:{lat:45.3161,lon:-65.8900,elev:38},   // Saint John NB
  CYYT:{lat:47.6186,lon:-52.7519,elev:140},  // St. John's NL
  CYGV:{lat:51.3994,lon:-56.0819,elev:48},   // Havre-Saint-Pierre / La Grande Rivière area
  // USA — Northeast / Mid-Atlantic regional
  KBUF:{lat:42.9405,lon:-78.7322,elev:215},  // Buffalo
  KSYR:{lat:43.1112,lon:-76.1063,elev:128},  // Syracuse
  KALB:{lat:42.7483,lon:-73.8017,elev:89},   // Albany
  KPVD:{lat:41.7265,lon:-71.4282,elev:15},   // Providence
  KMHT:{lat:42.9326,lon:-71.4357,elev:81},   // Manchester NH
  KBGR:{lat:44.8074,lon:-68.8282,elev:59},   // Bangor
  KPWM:{lat:43.6462,lon:-70.3093,elev:76},   // Portland ME
  KHPN:{lat:41.0670,lon:-73.7076,elev:122},  // Westchester (White Plains)
  KTEB:{lat:40.8501,lon:-74.0608,elev:3},    // Teterboro NJ (small jets)
  KABE:{lat:40.6521,lon:-75.4408,elev:124},  // Allentown PA
  KAVP:{lat:41.3385,lon:-75.7234,elev:289},  // Scranton/Wilkes-Barre
  KISP:{lat:40.7952,lon:-73.1002,elev:28},   // Long Island MacArthur
  KHVN:{lat:41.2638,lon:-72.8868,elev:4},    // New Haven
  // USA — Midwest regional
  KMDW:{lat:41.7860,lon:-87.7524,elev:188},  // Chicago Midway
  KGRR:{lat:42.8808,lon:-85.5228,elev:245},  // Grand Rapids
  KLAN:{lat:42.7787,lon:-84.5874,elev:282},  // Lansing
  KFTW:{lat:32.8199,lon:-97.3622,elev:218},  // Ft. Worth Meacham
  KHOU:{lat:29.6454,lon:-95.2789,elev:14},   // Houston Hobby
  KSAT:{lat:29.5337,lon:-98.4698,elev:242},  // San Antonio
  // El Paso is already in LOCS as KELP below — no duplicate needed
  KCOS:{lat:38.8058,lon:-104.7008,elev:1881},// Colorado Springs
  KDSM:{lat:41.5340,lon:-93.6631,elev:294},  // Des Moines
  KOMA:{lat:41.3032,lon:-95.8941,elev:299},  // Omaha Eppley
  KICT:{lat:37.6499,lon:-97.4331,elev:408},  // Wichita
  KMCI:{lat:39.2976,lon:-94.7139,elev:313},  // Kansas City
  KLIT:{lat:34.7294,lon:-92.2243,elev:75},   // Little Rock
  // USA — South regional
  KBHM:{lat:33.5629,lon:-86.7535,elev:193},  // Birmingham AL
  KMOB:{lat:30.6912,lon:-88.2428,elev:67},   // Mobile
  KJAN:{lat:32.3112,lon:-90.0759,elev:97},   // Jackson MS
  KCHA:{lat:35.0353,lon:-85.2038,elev:218},  // Chattanooga
  KTYS:{lat:35.8118,lon:-83.9940,elev:293},  // Knoxville
  KAVL:{lat:35.4362,lon:-82.5419,elev:661},  // Asheville NC
  KMYR:{lat:33.6797,lon:-78.9283,elev:9},    // Myrtle Beach
  KCHS:{lat:32.8986,lon:-80.0405,elev:14},   // Charleston SC
  KSAV:{lat:32.1276,lon:-81.2021,elev:15},   // Savannah
  KJAX:{lat:30.4941,lon:-81.6879,elev:9},    // Jacksonville
  KPNS:{lat:30.4734,lon:-87.1866,elev:36},   // Pensacola
  // USA — West regional
  KBUR:{lat:34.2007,lon:-118.3585,elev:238}, // Burbank / Hollywood
  KLGB:{lat:33.8177,lon:-118.1517,elev:18},  // Long Beach
  KONT:{lat:34.0560,lon:-117.6012,elev:288}, // Ontario CA
  KOAK:{lat:37.7213,lon:-122.2208,elev:2},   // Oakland
  KSJC:{lat:37.3626,lon:-121.9290,elev:18},  // San Jose
  KSMF:{lat:38.6954,lon:-121.5908,elev:8},   // Sacramento
  KFAT:{lat:36.7762,lon:-119.7181,elev:102}, // Fresno
  KRNO:{lat:39.4991,lon:-119.7681,elev:1341},// Reno
  KBOI:{lat:43.5644,lon:-116.2228,elev:874}, // Boise
  KBZN:{lat:45.7775,lon:-111.1531,elev:1369},// Bozeman
  KMSN:{lat:43.1399,lon:-89.3375,elev:265},  // Madison WI
  KFSD:{lat:43.5820,lon:-96.7419,elev:437},  // Sioux Falls
  // USA — Hawaii / Alaska
  PHKO:{lat:19.7386,lon:-156.0456,elev:14},  // Kona
  PHOG:{lat:20.8986,lon:-156.4305,elev:49},  // Maui Kahului
  PANC:{lat:61.1744,lon:-149.9964,elev:46},  // Anchorage
  PAFA:{lat:64.8151,lon:-147.8561,elev:135}, // Fairbanks
  PAJN:{lat:58.3550,lon:-134.5763,elev:6},   // Juneau
  // North America — USA
  KJFK:{lat:40.6413,lon:-73.7781,elev:4},KLAX:{lat:33.9425,lon:-118.4081,elev:38},
  KORD:{lat:41.9742,lon:-87.9073,elev:202},KATL:{lat:33.6367,lon:-84.4281,elev:313},
  KDFW:{lat:32.8968,lon:-97.0380,elev:182},KDEN:{lat:39.8561,lon:-104.6737,elev:1655},
  KSFO:{lat:KS_REF.lat,lon:KS_REF.lon,elev:4},KLAS:{lat:36.0840,lon:-115.1537,elev:664},
  KMIA:{lat:25.7959,lon:-80.2870,elev:3},KSEA:{lat:47.4502,lon:-122.3088,elev:132},
  KPHX:{lat:33.4373,lon:-112.0078,elev:337},KIAH:{lat:29.9902,lon:-95.3368,elev:30},
  KEWR:{lat:40.6895,lon:-74.1745,elev:9},KMSP:{lat:44.8848,lon:-93.2223,elev:256},
  KDTW:{lat:42.2124,lon:-83.3534,elev:195},KBOS:{lat:42.3656,lon:-71.0096,elev:9},
  KPHL:{lat:39.8721,lon:-75.2411,elev:11},KLGA:{lat:40.7773,lon:-73.8726,elev:7},
  KBWI:{lat:39.1754,lon:-76.6683,elev:46},KDCA:{lat:38.8521,lon:-77.0377,elev:15},
  KSLC:{lat:40.7884,lon:-111.9778,elev:1288},KFLL:{lat:26.0726,lon:-80.1527,elev:3},
  KMCO:{lat:28.4294,lon:-81.3089,elev:29},KIAH2:{lat:29.9844,lon:-95.3414,elev:30},
  KSTL:{lat:38.7487,lon:-90.3700,elev:189},KCLT:{lat:35.2140,lon:-80.9431,elev:237},
  KSAN:{lat:32.7336,lon:-117.1897,elev:5},KTPA:{lat:27.9755,lon:-82.5332,elev:9},
  KPDX:{lat:45.5888,lon:-122.5975,elev:9},KMEM:{lat:35.0424,lon:-89.9767,elev:103},
  KBNA:{lat:36.1245,lon:-86.6782,elev:183},KAUS:{lat:30.1945,lon:-97.6699,elev:160},
  KMSY:{lat:29.9934,lon:-90.2580,elev:2},KRDU:{lat:35.8776,lon:-78.7875,elev:132},
  KRIC:{lat:37.5052,lon:-77.3197,elev:52},KCMH:{lat:39.9998,lon:-82.8919,elev:248},
  KPIT:{lat:40.4915,lon:-80.2329,elev:365},KIND:{lat:39.7173,lon:-86.2944,elev:246},
  KSNA:{lat:33.6757,lon:-117.8682,elev:17},KSDF:{lat:38.1744,lon:-85.7360,elev:149},
  KELP:{lat:31.8072,lon:-106.3779,elev:1194},KABQ:{lat:35.0402,lon:-106.6090,elev:1640},
  KTUS:{lat:32.1161,lon:-110.9410,elev:779},KOKC:{lat:35.3931,lon:-97.6007,elev:398},
  KTUL:{lat:36.1984,lon:-95.8881,elev:202},KOMAHA:{lat:41.3032,lon:-95.8941,elev:299},
  // USA scenic
  ALPS:{lat:46.5,lon:7.9,elev:3600},
  EVEREST:{lat:27.9881,lon:86.925,elev:5300},GRANDCANYON:{lat:35.9524,lon:-112.147,elev:2000},
  // Mexico / Caribbean
  MMMX:{lat:19.4363,lon:-99.0721,elev:2237},MMGL:{lat:20.5218,lon:-103.3111,elev:1521},
  MMUN:{lat:21.0365,lon:-86.8771,elev:7},MMTY:{lat:25.7785,lon:-100.1066,elev:366},
  MYNN:{lat:25.0390,lon:-77.4662,elev:5},MBPV:{lat:21.7737,lon:-72.1887,elev:6},
  TJSJ:{lat:18.4394,lon:-66.0018,elev:9},MDSD:{lat:18.4297,lon:-69.6689,elev:17},
  // South America
  SBGR:{lat:-23.4356,lon:-46.4731,elev:750},SCEL:{lat:-33.3930,lon:-70.7858,elev:474},
  SKBO:{lat:4.7016,lon:-74.1469,elev:2549},SEQM:{lat:-0.1292,lon:-78.3576,elev:2400},
  SPJC:{lat:-12.0219,lon:-77.1143,elev:13},SAEZ:{lat:-34.8222,lon:-58.5358,elev:20},
  SBSP:{lat:-23.6261,lon:-46.6564,elev:802},SBPA:{lat:-29.9944,lon:-51.1714,elev:3},
  SBRJ:{lat:-22.9100,lon:-43.1631,elev:9},SBCF:{lat:-19.6244,lon:-43.9719,elev:827},
  // Europe — UK/Ireland
  EGLL:{lat:51.47,lon:-0.4543,elev:25},EGKK:{lat:51.1481,lon:-0.1903,elev:62},
  EGCC:{lat:53.3537,lon:-2.2750,elev:76},EGNX:{lat:52.8311,lon:-1.3281,elev:99},
  EGBB:{lat:52.4539,lon:-1.7480,elev:99},EGGD:{lat:51.3827,lon:-2.7191,elev:189},
  EGSS:{lat:51.8850,lon:0.2350,elev:103},EIDW:{lat:53.4213,lon:-6.2701,elev:74},
  // Europe — Western
  LFPG:{lat:48.9969,lon:2.5483,elev:119},LFPO:{lat:48.7233,lon:2.3794,elev:96},
  LSZH:{lat:47.4647,lon:8.5492,elev:432},LSGG:{lat:46.2381,lon:6.1089,elev:430},
  EHAM:{lat:52.3105,lon:4.7683,elev:-3},EBBR:{lat:50.9014,lon:4.4844,elev:56},
  EDDF:{lat:50.0264,lon:8.5431,elev:111},EDDM:{lat:48.3537,lon:11.7860,elev:448},
  EDDL:{lat:51.2895,lon:6.7668,elev:45},EDDB:{lat:52.3667,lon:13.5033,elev:37},
  LEMD:{lat:40.4936,lon:-3.5668,elev:610},LEBL:{lat:41.2971,lon:2.0785,elev:4},
  LIRF:{lat:41.8003,lon:12.2389,elev:14},LIML:{lat:45.4454,lon:9.2763,elev:107},
  LPPT:{lat:38.7756,lon:-9.1359,elev:113},LHBP:{lat:47.4369,lon:19.2556,elev:151},
  LOWW:{lat:48.1103,lon:16.5697,elev:183},LSZA:{lat:46.0044,lon:8.9109,elev:276},
  ESSA:{lat:59.6519,lon:17.9186,elev:42},ENGM:{lat:60.1939,lon:11.1004,elev:208},
  EKCH:{lat:55.6180,lon:12.6561,elev:17},EFHK:{lat:60.3172,lon:24.9633,elev:55},
  EPWA:{lat:52.1657,lon:20.9671,elev:110},LKPR:{lat:50.1008,lon:14.2600,elev:381},
  LYBE:{lat:44.8184,lon:20.3091,elev:99},LGAV:{lat:37.9364,lon:23.9445,elev:94},
  LTBA:{lat:40.9762,lon:28.8146,elev:157},LTFM:{lat:41.2753,lon:28.7519,elev:99},
  // Europe — Eastern / Russia
  UUEE:{lat:55.9736,lon:37.4125,elev:190},UUDD:{lat:55.4088,lon:37.9063,elev:178},
  UKBB:{lat:50.3450,lon:30.8947,elev:120},EVRA:{lat:56.9236,lon:23.9711,elev:10},
  EYVI:{lat:54.6341,lon:25.2858,elev:197},UMMS:{lat:53.8825,lon:28.0322,elev:204},
  LROP:{lat:44.5722,lon:26.1022,elev:95},LBSF:{lat:42.6967,lon:23.4114,elev:531},
  // Middle East / Africa
  OMDB:{lat:25.2532,lon:55.3657,elev:19},OMAA:{lat:24.4330,lon:54.6511,elev:27},
  OERK:{lat:24.9576,lon:46.6988,elev:620},OEJN:{lat:21.6796,lon:39.1565,elev:17},
  OTHH:{lat:25.2731,lon:51.6081,elev:13},OKBK:{lat:29.2267,lon:47.9689,elev:55},
  HECA:{lat:30.1219,lon:31.4056,elev:74},HAAB:{lat:8.9779,lon:38.7993,elev:2334},
  DNMM:{lat:6.5774,lon:3.3213,elev:38},FAOR:{lat:-26.1392,lon:28.2460,elev:1694},
  FACT:{lat:-33.9648,lon:18.6017,elev:46},FMMI:{lat:-18.7969,lon:47.4788,elev:1276},
  FCBB:{lat:-4.2517,lon:15.2531,elev:315},GOOG:{lat:14.7447,lon:-17.4902,elev:24},
  DTTA:{lat:36.8510,lon:10.2272,elev:6},GMME:{lat:34.0510,lon:-6.7517,elev:276},
  HKJK:{lat:-1.3192,lon:36.9275,elev:1624},HTDA:{lat:-6.8781,lon:39.2026,elev:55},
  // Asia — East
  RJTT:{lat:35.5494,lon:139.7798,elev:6},RJAA:{lat:35.7647,lon:140.3864,elev:41},
  RKSI:{lat:37.4602,lon:126.4407,elev:23},RKSS:{lat:37.5583,lon:126.7906,elev:18},
  ZSPD:{lat:31.1434,lon:121.8052,elev:4},ZBAA:{lat:40.0799,lon:116.5845,elev:35},
  ZGGG:{lat:23.3924,lon:113.2990,elev:15},VHHH:{lat:22.3080,lon:113.9185,elev:9},
  RCTP:{lat:25.0777,lon:121.2328,elev:33},WMKK:{lat:2.7456,lon:101.7099,elev:21},
  WSSS:{lat:1.3644,lon:103.9915,elev:7},VTBS:{lat:13.9132,lon:100.6070,elev:8},
  WIII:{lat:-6.1256,lon:106.6558,elev:8},RPLL:{lat:14.5086,lon:121.0197,elev:21},
  VOMM:{lat:12.9900,lon:80.1693,elev:16},VIDP:{lat:28.5665,lon:77.1031,elev:237},
  VABB:{lat:19.0896,lon:72.8656,elev:11},OMAB:{lat:24.2528,lon:54.6511,elev:27},
  // Asia — Central / South
  OAKB:{lat:34.5659,lon:69.2123,elev:1791},OPKC:{lat:24.9065,lon:67.1608,elev:22},
  VCBI:{lat:7.1808,lon:79.8841,elev:7},UAAA:{lat:43.3528,lon:77.0405,elev:647},
  UTDD:{lat:38.5433,lon:68.8247,elev:864},
  // Oceania / Pacific
  YSSY:{lat:-33.9399,lon:151.1753,elev:6},YMML:{lat:-37.6733,lon:144.8430,elev:131},
  YBBN:{lat:-27.3842,lon:153.1175,elev:5},YPPH:{lat:-31.9403,lon:115.9669,elev:15},
  NZAA:{lat:-37.0082,lon:174.7917,elev:7},NZWN:{lat:-41.3272,lon:174.8051,elev:12},
  NFFN:{lat:-17.7554,lon:177.4432,elev:5},NTAA:{lat:-17.5534,lon:-149.6062,elev:2},
  PGUM:{lat:13.4834,lon:144.7960,elev:91},PHNL:{lat:21.3245,lon:-157.9251,elev:4},
  // Scenic
  MATTERHORN:{lat:45.9763,lon:7.6586,elev:4300},FUJI:{lat:35.3606,lon:138.7274,elev:3700},
  YOSEMITE:{lat:37.7456,lon:-119.5936,elev:1200},ZION:{lat:37.2982,lon:-113.0263,elev:1300},
  MONUMENT:{lat:36.9980,lon:-110.0985,elev:1700},GEIRANGER:{lat:62.1049,lon:7.2058,elev:0},
  IGUAZU:{lat:-25.6958,lon:-54.4353,elev:185},VICTORIA:{lat:-17.9314,lon:25.8564,elev:1000},
  ANTARCTICAPEN:{lat:-63.4,lon:-57.0,elev:0},GREENLAND:{lat:72.0,lon:-40.0,elev:2000}
};
const RUNWAYS={
  // Canada — Ontario
  CYYZ:{hdg:060,len:3389,wid:61},CYTZ:{hdg:080,len:1216,wid:30},
  CYKF:{hdg:140,len:1524,wid:46},CYOO:{hdg:120,len:1768,wid:46},
  CYHM:{hdg:120,len:1798,wid:46},CYKZ:{hdg:150,len:914,wid:23},
  CYXU:{hdg:150,len:2744,wid:61},CYWG:{hdg:130,len:2743,wid:61},
  // Canada — Quebec
  CYUL:{hdg:064,len:3353,wid:61},CYMX:{hdg:060,len:3658,wid:61},
  CYHU:{hdg:150,len:1829,wid:46},CYQB:{hdg:240,len:2743,wid:61},
  CYSB:{hdg:040,len:2134,wid:46},
  // Canada — BC/West
  CYVR:{hdg:080,len:3600,wid:61},CYYJ:{hdg:088,len:1757,wid:45},
  CZBB:{hdg:120,len:1067,wid:23},CYCD:{hdg:160,len:152
