uniform int uSample;
uint rngState;
float randomValue() {
  rngState=rngState*747796405u+2891336453u;
  uint word=((rngState>>((rngState>>28u)+4u))^rngState)*277803737u;
  word=(word>>22u)^word;
  return float(word>>8u)/16777216.0; // [0,1); float rounding must never select source N.
}

vec3 around(vec3 axis, float cosine, float phi) {
  vec3 tangent=normalize(cross(abs(axis.z)<0.9 ? vec3(0,0,1) : vec3(0,1,0),axis));
  vec3 bitangent=cross(axis,tangent);
  return axis*cosine+sqrt(max(0.0,1.0-cosine*cosine))*(cos(phi)*tangent+sin(phi)*bitangent);
}

// Rough deep water: dielectric GGX reflection; transmitted energy is absorbed.
// Both NEE and continuation use the same BSDF and solid-angle density.
const float WATER_ALPHA=0.045;
float waterFresnel(float cosine) {
  float eta=1.333,c=clamp(cosine,0.0,1.0);
  float ct=sqrt(1.0-(1.0-c*c)/(eta*eta));
  float rs=(c-eta*ct)/(c+eta*ct),rp=(eta*c-ct)/(eta*c+ct);
  return 0.5*(rs*rs+rp*rp);
}
float waterDistribution(float cosine) {
  float a2=WATER_ALPHA*WATER_ALPHA;
  float denominator=cosine*cosine*(a2-1.0)+1.0;
  return a2/(PI*denominator*denominator);
}
float waterMasking(float cosine) {
  return 2.0*cosine/(cosine+sqrt(WATER_ALPHA*WATER_ALPHA+(1.0-WATER_ALPHA*WATER_ALPHA)*cosine*cosine));
}
// Returns f * cos(theta_in) and the reflection sampling PDF.
vec2 waterReflection(vec3 normal,vec3 outgoing,vec3 incoming) {
  float noV=dot(normal,outgoing),noL=dot(normal,incoming);
  if(noV<=0.0 || noL<=0.0) return vec2(0.0);
  vec3 halfVector=normalize(outgoing+incoming);
  float noH=max(0.0,dot(normal,halfVector));
  // Symmetric half-angle expression avoids cancellation in grazing dot(v,h).
  float voH=sqrt(max(1e-8,0.5*(1.0+dot(outgoing,incoming))));
  float distribution=waterDistribution(noH);
  float brdf=waterFresnel(voH)*distribution*waterMasking(noV)*waterMasking(noL)/(4.0*noV*noL);
  return vec2(brdf*noL,distribution*noH/(4.0*voH));
}
vec3 waterSample(vec3 normal,vec3 outgoing) {
  float u=randomValue();
  float cosine=sqrt((1.0-u)/(1.0+(WATER_ALPHA*WATER_ALPHA-1.0)*u));
  vec3 halfVector=around(normal,cosine,2.0*PI*randomValue());
  return normalize(reflect(-outgoing,halfVector));
}

vec3 solarSample() {
  return around(uSun,1.0-randomValue()*(1.0-cos(SOLAR_RADIUS)),2.0*PI*randomValue());
}

float maxComponent(vec4 v) {return max(max(v.x,v.y),max(v.z,v.w));}
float average(vec4 v) {return dot(v,vec4(0.25));}

// Particle tables have one row per 10 nm; `bin` selects one wavelength's rows.
vec4 particleRow(int column,int species,float bin) {
  int row=min(39,int(bin));
  vec4 a=species==1 ? texelFetch(uAerosolPhase,ivec2(column,row),0) : texelFetch(uCloudPhase,ivec2(column,row),0);
  vec4 b=species==1 ? texelFetch(uAerosolPhase,ivec2(column,row+1),0) : texelFetch(uCloudPhase,ivec2(column,row+1),0);
  return mix(a,b,bin-float(row));
}
vec4 rayleighCoefficient() {
  vec4 sigma2=1.0/(wavelength*wavelength*1e-6);
  vec4 n=1.0+1e-8*(8342.13+2406030.0/(130.0-sigma2)+15997.0/(38.9-sigma2));
  float nRef=1.000277824; // Edlén dry-air dispersion at 550 nm.
  vec4 factor=(n*n-1.0)/(n*n+2.0)/((nRef*nRef-1.0)/(nRef*nRef+2.0));
  return 0.013558*pow(550.0/wavelength,vec4(4.0))*factor*factor;
}
void prepareWavelength() {
  sigmaRayleigh=rayleighCoefficient();
  for (int k=0;k<4;k++) {
    vec2 aerosol=particleRow(0,1,spectralBin[k]).ba,cloud=particleRow(0,2,spectralBin[k]).ba;
    aerosolExtinction[k]=aerosol.x;aerosolScattering[k]=aerosol.y;
    cloudExtinction[k]=cloud.x;cloudScattering[k]=cloud.y;
  }
  aerosolExtinction*=uAerosol*uAerosolScale;aerosolScattering*=uAerosol*uAerosolScale;
  glassIndex=glassIndexAtWavelength();
  solarSpectrum=blackbody(5772.0)*uSolarPower;lampSpectrum=blackbody(2800.0)*uLampScale;
}
vec4 extinctionAt(vec3 p) {
  if (!uAtmosphere || uPressure<=0.0) return vec4(0.0);
  return (sigmaRayleigh+aerosolExtinction)*airDensity(p)+weatherAt(p).r*cloudExtinction;
}
// Phase function values and sampling densities at the four path wavelengths.
// Particle phase functions depend on wavelength: the hero's tabulated inverse
// CDF samples directions, and the other densities enter spectral MIS.
// The sampling density is taken to be the normalized phase function itself.
// Differencing the float32 CDF instead returns zero in backscatter bins whose
// increments fall below its precision near 1; a direction recovered there
// through cos/acos then multiplied a path's weight by about 1e8. Sampling
// matches the phase function bin by bin; only the distribution within a
// bin (under 0.4°) differs.
void scatteringPhase(float cosine,int species,out vec4 phase,out vec4 pdf) {
  if (species==0) {
    phase=vec4(3.0/(16.0*PI)*(1.0+cosine*cosine));pdf=phase;
    return;
  }
  float u=sqrt(acos(clamp(cosine,-1.0,1.0))/PI);
  float index=u*1023.0;
  int lo=min(1022,int(index));
  for (int k=0;k<4;k++) phase[k]=mix(particleRow(lo,species,spectralBin[k]).r,particleRow(lo+1,species,spectralBin[k]).r,index-float(lo));
  pdf=phase;
}
vec3 phaseSample(vec3 axis,int species) {
  float cosine;
  if (species==0) {
    cosine=0.0;
    for (int i=0;i<32;i++) {
      cosine=2.0*randomValue()-1.0;
      if (randomValue()<0.5*(1.0+cosine*cosine)) break;
    }
  } else {
    float target=randomValue();
    int lo=0,hi=1023;
    for (int i=0;i<10;i++) {
      int mid=(lo+hi)/2;
      if (particleRow(mid,species,spectralBin.x).g<target) lo=mid;else hi=mid;
    }
    float a=particleRow(lo,species,spectralBin.x).g,b=particleRow(hi,species,spectralBin.x).g;
    float u=(float(lo)+(target-a)/max(b-a,1e-8))/1023.0;
    cosine=cos(PI*u*u);
  }
  return around(axis,clamp(cosine,-1.0,1.0),2.0*PI*randomValue());
}

// Per-cell majorants bound all eight trilinearly interpolated cloud samples.
// Air's global bound is small; a global cloud bound would stall dense scenes.
// Both bound extinction at every wavelength, so tentative collisions are shared.
float cellMajorant(vec3 p,vec3 d,out float travel) {
  if (!uClouds) {travel=1e20;return uAirMajorant;}
  vec3 count=vec3(textureSize(uWeather,0));
  vec3 size=vec3(2.0*uRadius,2.0*uRadius,uLength);
  vec3 grid=(p/size+0.5)*count+0.5;
  ivec3 cell=ivec3(floor(grid));
  cell=clamp(cell,ivec3(0),ivec3(count));
  vec3 edge=(vec3(cell)+step(vec3(0.0),d)-0.5)/count*size-size*0.5;
  vec3 dt=(edge-p)/vec3(abs(d.x)<1e-9 ? 1e-9 : d.x,abs(d.y)<1e-9 ? 1e-9 : d.y,abs(d.z)<1e-9 ? 1e-9 : d.z);
  if (abs(d.x)<1e-9) dt.x=1e20;
  if (abs(d.y)<1e-9) dt.y=1e20;
  if (abs(d.z)<1e-9) dt.z=1e20;
  travel=max(EPS,min(dt.x,min(dt.y,dt.z)));
  return uAirMajorant+(uClouds ? texelFetch(uCloudMajorant,cell,0).r : 0.0);
}

// Ratio tracking at all four wavelengths. Each factor is also the probability
// that delta tracking at that wavelength would pass the same tentative collision.
vec4 shadowTransmission(vec3 p,vec3 d,float distance) {
  if (!uAtmosphere) return vec4(1.0);
  vec4 weight=vec4(1.0);
  float t=0.0;
  for (int i=0;i<2048;i++) {
    if (t>=distance) return weight;
    float cellDistance;
    float majorant=cellMajorant(p+d*(t+EPS),d,cellDistance);
    float flight=majorant>0.0 ? -log(max(1e-7,1.0-randomValue()))/majorant : 1e20;
    float remaining=min(cellDistance,distance-t);
    if (flight>=remaining) { t+=remaining+EPS;continue; }
    t+=flight;
    weight*=max(vec4(0.0),1.0-extinctionAt(p+d*t)/majorant);
    if (maxComponent(weight)<1e-7) return vec4(0.0);
  }
  return vec4(0.0);
}

// Delta tracking with the hero's collision probabilities (PBRT-v4 volumetric
// spectral MIS). `beta` is path throughput over the hero's sampling density;
// `ru` holds each wavelength's density relative to the hero's, and `rl` that of
// reaching the same point by next-event estimation from the last vertex, which
// passes null collisions with certainty.
bool mediumEvent(vec3 p,vec3 d,float distance,inout vec4 beta,inout vec4 ru,inout vec4 rl,out vec3 point,out int species) {
  point=p+d*distance;species=0;
  if (!uAtmosphere) return false;
  float t=0.0;
  for (int i=0;i<2048;i++) {
    if (t>=distance) return false;
    float cellDistance;
    float majorant=cellMajorant(p+d*(t+EPS),d,cellDistance);
    float flight=majorant>0.0 ? -log(max(1e-7,1.0-randomValue()))/majorant : 1e20;
    float remaining=min(cellDistance,distance-t);
    if (flight>=remaining) {t+=remaining+EPS;continue;}
    t+=flight;
    vec3 q=p+d*t;
    float density=airDensity(q),liquid=weatherAt(q).r;
    vec4 molecular=sigmaRayleigh*density;
    vec4 aerosol=aerosolScattering*density;
    vec4 cloud=liquid*cloudScattering;
    vec4 total=(sigmaRayleigh+aerosolExtinction)*density+liquid*cloudExtinction;
    float choice=randomValue()*majorant;
    if (choice>=total.x) {
      vec4 nullCollision=max(vec4(0.0),majorant-total);
      beta*=nullCollision/nullCollision.x;ru*=nullCollision/nullCollision.x;rl*=majorant/nullCollision.x;
      continue;
    }
    vec4 sigma;
    if (choice<molecular.x) {species=0;sigma=molecular;}
    else if (choice<molecular.x+aerosol.x) {species=1;sigma=aerosol;}
    else if (choice<molecular.x+aerosol.x+cloud.x) {species=2;sigma=cloud;}
    else {beta=vec4(0.0);return false;}
    beta*=sigma/sigma.x;ru*=sigma/sigma.x;
    point=q;
    return true;
  }
  beta=vec4(0.0);return false;
}

// Only beta/mean(ru) and ratios between densities enter an estimate. Keeping
// mean(ru) at 1 bounds the float range of long walks.
void normalizePath(inout vec4 beta,inout vec4 ru) {
  float scale=average(ru);
  if (scale>0.0) {beta/=scale;ru/=scale;}
}

// Sunlight enters along hull routes: directly through a pane, or by one mirror
// and a pane. The analytic hull decides which routes can carry a sampled solar
// direction to p; terrain, media and glass losses are applied afterwards. A
// closed route contributes nothing, so sampling only open routes is unbiased.
vec3 routeDirection(int source,vec3 sun) {return source==0 ? sun : reflect(sun,uMirrorNormal[source-1]);}
float routeWeight(vec3 p,vec3 direction,vec3 sun) {
  vec3 opening=p+direction*boundaryDistance(p,direction);
  if (!windowOpening(opening) || abs(length(opening.xy)-uRadius)>0.001) return 0.0;
  vec3 outside=opening+direction*(EPS*4.0),leaving=direction;
  float weight=exteriorPath(outside,leaving);
  return dot(leaving,sun)<0.9999999 ? 0.0 : weight;
}
// Exterior throughput of each route (x: direct, yzw: mirrors) and the number open.
vec4 openRoutes(vec3 p,vec3 sun,out int count) {
  vec4 weights=vec4(0.0);
  count=0;
  for (int source=0;source<4;source++) {
    if (source>uMirrorCount) break;
    weights[source]=routeWeight(p,routeDirection(source,sun),sun);
    if (weights[source]>0.0) count++;
  }
  return weights;
}

// Next-event estimation samples the finite Sun, then one open route, and tests
// the entire aperture → mirror → Sun connection. `ru` holds each wavelength's
// path density relative to the hero's. When `weighted`, the balance heuristic
// spans light and phase/BSDF sampling at all four wavelengths; phase sampling
// would also have to survive the null collisions that ratio tracking weights.
// The forced camera-segment estimate has no phase-sampling partner.
vec4 directLight(vec3 p,vec3 normal,vec3 outgoing,int species,vec4 albedo,bool weighted,vec4 ru) {
  vec3 sun=solarSample();
  int count;
  vec4 routes=openRoutes(p,sun,count);
  if (count==0) return vec4(0.0);
  int pick=min(count-1,int(randomValue()*float(count))),source=0;
  for (int i=0;i<4;i++) {
    if (routes[i]>0.0) {
      if (pick==0) {source=i;break;}
      pick--;
    }
  }
  vec3 direction=routeDirection(source,sun);
  vec4 phase,samplingPdf;
  if (species==-2) {
    vec2 water=waterReflection(normal,outgoing,direction);
    phase=vec4(water.x);samplingPdf=vec4(water.y);
  } else if (species<0) {
    samplingPdf=vec4(max(0.0,dot(normal,direction))/PI);phase=samplingPdf;
  } else scatteringPhase(dot(outgoing,direction),species,phase,samplingPdf);
  if (maxComponent(phase)<=0.0) return vec4(0.0);
  // An open route reaches the pane at the analytic hull. Media are tracked to
  // it first: inside dense cloud nothing gets through, and the far costlier
  // terrain march is skipped. Unblocked, the march ends at that same hull.
  vec4 transmission=shadowTransmission(p,direction,boundaryDistance(p,direction));
  if (maxComponent(transmission)<=0.0) return vec4(0.0);
  float distance=traceInterior(p,direction);
  vec3 opening=p+direction*distance;
  // The hull test passed; this rejects terrain, trees or roofs in the way.
  if (!windowOpening(opening) || abs(length(opening.xy)-uRadius)>0.001) return vec4(0.0);
  vec4 reflectance,transmittance;
  glassPlate(dot(normalize(opening.xy),direction.xy),reflectance,transmittance);
  float lightPdf=1.0/(float(count)*SUN_SOLID_ANGLE);
  float density=average(ru)*lightPdf+(weighted ? average(ru*samplingPdf*transmission) : 0.0);
  return albedo*phase*transmittance*routes[source]*transmission*solarRadiance()/density;
}

// The state of one path, so that a path can also be advanced in bounded
// steps across draws (an uncapped reference keeps it in textures).
struct PathState {
  vec3 p,direction,lastVertex;
  // beta: throughput over the hero's sampling density. ru: each wavelength's
  // path density relative to the hero's. rl: the same for reaching the next
  // vertex by next-event estimation (set at each scattering vertex).
  vec4 beta,ru,rl,radiance,scattered;
  float lastPdf,pending;
  bool haze,neeReachable,inside,cloudPath,forced,singleAir,cameraSegment,done;
  int mirrorBounces,order,droplets,events;
};

PathState startPath(vec3 p,vec3 direction) {
  PathState s;
  s.p=p;s.direction=direction;s.lastVertex=p;
  s.beta=vec4(1.0);s.ru=vec4(1.0);s.rl=vec4(1.0);s.radiance=vec4(0.0);s.scattered=vec4(0.0);
  s.lastPdf=0.0;s.pending=-1.0;
  s.haze=false;s.neeReachable=true;s.inside=true;s.cloudPath=false;
  // Every camera ray estimates single scattering by air with one forced
  // collision on its segment; analog air collisions there omit that term
  // (no next-event estimate, no direct solar hit) to avoid counting it twice.
  s.forced=uAtmosphere && uPressure>0.0 && uAirMajorant>0.0;s.singleAir=false;s.cameraSegment=true;
  s.done=false;
  s.mirrorBounces=0;s.order=0;s.droplets=0;s.events=0;
  return s;
}

// Trees and houses are traced on the first two segments of a path. Surface
// atlas paths leave the bare terrain: the raster preview draws no objects.
bool pathLandObjects=true;

// Advances a path by at most `limit` events, up to `maxEvents` in total.
// After `dropletLimit` droplet scatterings (0: never) a path ends in the
// scattered-light cache. `excludeDirect` omits sunlight reaching the start
// unscattered along routes that next-event estimation samples; cache paths
// need only the scattered field.
void advancePath(inout PathState s,int limit,int maxEvents,int dropletLimit,bool excludeDirect) {
  for (int iteration=0;iteration<limit;iteration++) {
    if (s.done) return;
    if (s.events>=maxEvents || (!uClouds && s.events>=65)) {s.done=true;return;}
    s.events++;
    if (!s.inside) {
      float closest=shellHit(s.p,s.direction);
      int panel=-1;
      for (int i=0;i<3;i++) {
        if (i>=uMirrorCount) break;
        float t=mirrorHit(s.p,s.direction,i);
        if (t<closest) {closest=t;panel=i;}
      }
      if (closest>1e19) {
        if (dot(s.direction,uSun)>=cos(SOLAR_RADIUS)) {
          // Next-event estimation chose among the routes open at the last vertex.
          bool lightSampled=s.lastPdf>0.0 && s.neeReachable && s.mirrorBounces<=1;
          bool direct=s.order==0 && s.neeReachable && s.mirrorBounces<=1;
          float density=average(s.ru);
          if (lightSampled) {
            int count;
            openRoutes(s.lastVertex,s.direction,count);
            density+=average(s.rl)/(float(max(count,1))*SUN_SOLID_ANGLE);
          }
          if (!(lightSampled && s.singleAir) && !(excludeDirect && direct)) s.radiance+=s.beta*solarRadiance()/density;
        }
        s.done=true;return;
      }
      vec3 hit=s.p+s.direction*closest;
      if (panel>=0) {
        if (dot(s.direction,uMirrorNormal[panel])<=0.0) {s.done=true;return;} // Black rear coating.
        s.direction=reflect(s.direction,uMirrorNormal[panel]);
        s.beta*=uMirrorReflectivity;s.mirrorBounces++;
        s.p=hit+s.direction*(EPS*4.0);continue;
      }
      if (!windowOpening(hit)) {s.done=true;return;} // Black exterior hull.
      vec3 normal=normalize(vec3(hit.xy,0));
      vec4 reflectance,transmittance;
      glassPlate(dot(normal,s.direction),reflectance,transmittance);
      // One choice for all wavelengths, with their mean reflectance.
      float chance=average(reflectance);
      if (randomValue()<chance) {s.direction=reflect(s.direction,normal);s.beta*=reflectance/chance;s.neeReachable=false;}
      else {s.beta*=transmittance/max(1.0-chance,1e-8);s.inside=true;s.neeReachable=false;}
      s.p=hit+s.direction*(EPS*4.0);continue;
    }
    landObjects=pathLandObjects && s.order<2;
    float distance=s.pending>=0.0 ? s.pending : traceInterior(s.p,s.direction);
    s.pending=-1.0;
    vec3 point;int species;
    // Each iteration makes at most one next-event connection after choosing its
    // continuation. A single call site keeps one inlined visibility test.
    bool connect=false,alive=true,roulette=true,weighted=true,forcedEstimate=false;
    vec4 connectWeight=s.beta,connectAlbedo=vec4(1.0),connectDensity=s.ru;
    vec3 connectPoint=s.p,connectNormal=vec3(0),connectOutgoing=vec3(0);
    int connectSpecies=-1;
    if (s.forced) {
      // The collision is sampled ∝ majorant transmittance on the segment; ratio
      // tracking estimates the real transmittance. The next iteration repeats
      // this segment with the analog collision or surface hit.
      s.forced=false;s.pending=distance;roulette=false;
      float survival=exp(-uAirMajorant*distance);
      float t=-log(max(1e-12,1.0-randomValue()*(1.0-survival)))/uAirMajorant;
      vec3 q=s.p+s.direction*t;
      float density=airDensity(q);
      vec4 molecular=sigmaRayleigh*density,aerosol=aerosolScattering*density;
      float scattering=dot(molecular+aerosol,vec4(1.0));
      if (scattering>0.0) {
        // One scatterer for all wavelengths, chosen by its mean share.
        float molecularChance=dot(molecular,vec4(1.0))/scattering;
        bool rayleigh=randomValue()<molecularChance;
        connect=true;weighted=false;forcedEstimate=true;connectPoint=q;connectOutgoing=s.direction;
        connectSpecies=rayleigh ? 0 : 1;
        vec4 sigma=rayleigh ? molecular/molecularChance : aerosol/(1.0-molecularChance);
        connectWeight=s.beta*sigma*(1.0-survival)/(uAirMajorant*exp(-uAirMajorant*t))*shadowTransmission(s.p,s.direction,t);
      }
    } else if (mediumEvent(s.p,s.direction,distance,s.beta,s.ru,s.rl,point,species)) {
      s.cloudPath=s.cloudPath || species==2;
      normalizePath(s.beta,s.ru);
      // Only the camera segment itself; segments after a pane reflection are not
      // covered by the forced estimate.
      s.singleAir=s.cameraSegment && species<2;s.cameraSegment=false;
      connect=!s.singleAir;connectWeight=s.beta;connectDensity=s.ru;connectPoint=point;connectOutgoing=s.direction;connectSpecies=species;
      s.haze=s.haze || s.order==0;
      if (species==2 && dropletLimit>0 && (++s.droplets>=dropletLimit || cacheDeep(point))) {
        // Light scattered more often, or inside optically deep cloud, comes from
        // the cache. Unscattered sunlight is not cached: next-event estimation
        // supplies it here at full weight.
        weighted=false;alive=false;
        s.radiance+=s.beta*cachedRadiance(point,-s.direction,uCloudAsymmetry)/average(s.ru);
      } else {
        vec3 next=phaseSample(s.direction,species);
        vec4 phase,pdf;
        scatteringPhase(dot(s.direction,next),species,phase,pdf);
        s.lastPdf=max(pdf.x,1e-10);
        s.rl=s.ru/s.lastPdf;
        s.beta*=phase/s.lastPdf;s.ru*=pdf/s.lastPdf;
        s.direction=next;
      }
      s.p=point;s.lastVertex=point;s.neeReachable=true;s.order++;
    } else {
      if (maxComponent(s.beta)<=0.0) {s.done=true;return;}
      s.cameraSegment=false;
      vec3 hit=s.p+s.direction*distance;
      bool cap=abs(hit.z)>=uLength*0.5-0.001;
      bool pane=!cap && windowAt(atan(hit.y,hit.x)) && abs(length(hit.xy)-uRadius)<0.001;
      vec2 id;
      float kind=cap || pane ? 0.0 : landKind(hit,id);
      vec3 normal=cap ? vec3(0,0,-sign(hit.z)) : pane ? -normalize(vec3(hit.xy,0)) : landNormal(hit,kind);
      if (windowOpening(hit) && abs(length(hit.xy)-uRadius)<0.001) {
        // Beyond the panes, space is black except along routes to the Sun, which
        // next-event estimation already samples. Reflections are chosen more often
        // than their Fresnel probability; weights keep the estimate unbiased.
        vec4 reflectance,transmittance;
        glassPlate(dot(normal,s.direction),reflectance,transmittance);
        const float REFLECTION_CHANCE=0.85;
        if (randomValue()<REFLECTION_CHANCE) {
          s.beta*=reflectance/REFLECTION_CHANCE;
          s.direction=reflect(s.direction,normal);s.p=hit+s.direction*(EPS*4.0);s.neeReachable=false;
        } else {
          s.beta*=transmittance/(1.0-REFLECTION_CHANCE);
          s.p=hit+s.direction*(EPS*4.0);s.inside=false;s.mirrorBounces=0;
        }
      } else {
        vec2 ground=groundCoordinates(hit);
        bool river=!cap && !windowAt(atan(hit.y,hit.x)) && riverEdge(ground)<0.0;
        normalizePath(s.beta,s.ru);
        connect=true;connectWeight=s.beta;connectDensity=s.ru;connectPoint=hit+normal*(EPS*4.0);
        s.p=connectPoint;s.lastVertex=connectPoint;s.singleAir=false;s.order++;
        if (river) {
          vec3 outgoing=-s.direction;
          connectNormal=normal;connectOutgoing=outgoing;connectSpecies=-2;
          vec3 next=waterSample(normal,outgoing);
          vec2 water=waterReflection(normal,outgoing,next);
          alive=water.y>0.0;roulette=false;
          s.lastPdf=max(water.y,1e-10);
          s.beta*=water.x/s.lastPdf;s.rl=s.ru/s.lastPdf;
          s.direction=next;s.neeReachable=true;
        } else {
          vec4 albedo=materialSpectrum(materialAlbedo(hit,normal,kind,id));
          vec3 shading=cap ? normal : shadingNormal(hit,normal,kind,id);
          // Emission is a source term; it does not brighten unlit fields or endcaps.
          if (!cap && !windowAt(atan(hit.y,hit.x)) && uSolarPower<0.02) s.radiance+=s.beta*settlementLamp(ground)*lampRadiance()/average(s.ru);
          connectNormal=shading;connectAlbedo=albedo;
          s.beta*=albedo;
          s.direction=around(shading,sqrt(randomValue()),2.0*PI*randomValue());
          // Shading-normal samples beneath the geometric surface are absorbed.
          alive=dot(s.direction,normal)>0.0;
          s.lastPdf=max(0.0,dot(shading,s.direction))/PI;s.rl=s.ru/max(s.lastPdf,1e-10);s.neeReachable=true;
        }
      }
    }
    if (connect) {
      vec4 light=connectWeight*directLight(connectPoint,connectNormal,connectOutgoing,connectSpecies,connectAlbedo,weighted,connectDensity);
      if (forcedEstimate) s.scattered+=light;
      else s.radiance+=light;
    }
    if (!alive) {s.done=true;return;}
    // Direct lighting is already estimated above. Terminate weak continuation
    // paths from the first event; surviving paths retain their expected energy.
    if (s.order>=1 && roulette) {
      // A compulsory 5% loss per collision makes the hundreds of conservative
      // droplet scatterings in fog exponentially rare, extremely bright paths.
      // Still terminate weak paths, but let unit-throughput cloud paths live.
      float survival=min(s.cloudPath ? 1.0 : 0.95,maxComponent(s.beta)/average(s.ru));
      if (randomValue()>=survival) {s.done=true;return;}
      s.beta/=survival;
    }
  }
}

// Total spectral radiance at the four path wavelengths; `hazeRadiance`
// receives the haze part: single scattering of air on the camera segment plus
// paths whose first event is a medium collision there. The display filter
// treats it separately from light reflected by visible surfaces.
vec4 pathRadiance(vec3 p,vec3 direction,int dropletLimit,bool excludeDirect,out vec4 hazeRadiance) {
  PathState s=startPath(p,direction);
  advancePath(s,1025,1025,dropletLimit,excludeDirect);
  hazeRadiance=s.scattered+(s.haze ? s.radiance : vec4(0.0));
  return s.radiance+s.scattered;
}
