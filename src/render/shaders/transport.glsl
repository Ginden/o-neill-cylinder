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
void scatteringPhase(float cosine,int species,out vec4 phase,out vec4 pdf) {
  if (species==0) {
    phase=vec4(3.0/(16.0*PI)*(1.0+cosine*cosine));pdf=phase;
    return;
  }
  float theta=acos(clamp(cosine,-1.0,1.0));
  float u=max(1e-6,sqrt(theta/PI));
  float index=u*1023.0;
  int lo=min(1022,int(index));
  float jacobian=1023.0/(4.0*PI*PI*u*max(sin(theta),1e-8));
  for (int k=0;k<4;k++) {
    vec4 a=particleRow(lo,species,spectralBin[k]),b=particleRow(lo+1,species,spectralBin[k]);
    phase[k]=mix(a.r,b.r,index-float(lo));
    pdf[k]=(b.g-a.g)*jacobian;
  }
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
  float distance=traceInterior(p,direction);
  vec3 opening=p+direction*distance;
  // The hull test passed; this rejects terrain, trees or roofs in the way.
  if (!windowOpening(opening) || abs(length(opening.xy)-uRadius)>0.001) return vec4(0.0);
  vec4 reflectance,transmittance;
  glassPlate(dot(normalize(opening.xy),direction.xy),reflectance,transmittance);
  vec4 transmission=shadowTransmission(p,direction,distance);
  float lightPdf=1.0/(float(count)*SUN_SOLID_ANGLE);
  float density=average(ru)*lightPdf+(weighted ? average(ru*samplingPdf*transmission) : 0.0);
  return albedo*phase*transmittance*routes[source]*transmission*solarRadiance()/density;
}

// Returns total spectral radiance at the four path wavelengths; `hazeRadiance`
// receives the haze part: single scattering of air on the camera segment plus
// paths whose first event is a medium collision there. The display filter
// treats it separately from light reflected by visible surfaces.
vec4 pathRadiance(vec3 p,vec3 direction,out vec4 hazeRadiance) {
  vec4 beta=vec4(1.0),ru=vec4(1.0),rl=vec4(1.0),radiance=vec4(0.0),scattered=vec4(0.0);
  bool haze=false;
  float lastPdf=0.0;
  vec3 lastVertex=p;
  bool neeReachable=true;
  bool inside=true;
  int mirrorBounces=0,order=0;
  bool cloudPath=false;
  // Every camera ray estimates single scattering by air with one forced
  // collision on its segment; analog air collisions there omit that term
  // (no next-event estimate, no direct solar hit) to avoid counting it twice.
  bool forced=uAtmosphere && uPressure>0.0 && uAirMajorant>0.0,singleAir=false,cameraSegment=true;
  float pending=-1.0;
  for (int iteration=0;iteration<1025;iteration++) {
    if (!uClouds && iteration>=65) break;
    if (!inside) {
      float closest=shellHit(p,direction);
      int panel=-1;
      for (int i=0;i<3;i++) {
        if (i>=uMirrorCount) break;
        float t=mirrorHit(p,direction,i);
        if (t<closest) {closest=t;panel=i;}
      }
      if (closest>1e19) {
        if (dot(direction,uSun)>=cos(SOLAR_RADIUS)) {
          // Next-event estimation chose among the routes open at the last vertex.
          bool lightSampled=lastPdf>0.0 && neeReachable && mirrorBounces<=1;
          float density=average(ru);
          if (lightSampled) {
            int count;
            openRoutes(lastVertex,direction,count);
            density+=average(rl)/(float(max(count,1))*SUN_SOLID_ANGLE);
          }
          if (!(lightSampled && singleAir)) radiance+=beta*solarRadiance()/density;
        }
        break;
      }
      vec3 hit=p+direction*closest;
      if (panel>=0) {
        if (dot(direction,uMirrorNormal[panel])<=0.0) break; // Black rear coating.
        direction=reflect(direction,uMirrorNormal[panel]);
        beta*=uMirrorReflectivity;mirrorBounces++;
        p=hit+direction*(EPS*4.0);continue;
      }
      if (!windowOpening(hit)) break; // Black exterior hull.
      vec3 normal=normalize(vec3(hit.xy,0));
      vec4 reflectance,transmittance;
      glassPlate(dot(normal,direction),reflectance,transmittance);
      // One choice for all wavelengths, with their mean reflectance.
      float chance=average(reflectance);
      if (randomValue()<chance) {direction=reflect(direction,normal);beta*=reflectance/chance;neeReachable=false;}
      else {beta*=transmittance/max(1.0-chance,1e-8);inside=true;neeReachable=false;}
      p=hit+direction*(EPS*4.0);continue;
    }
    landObjects=order<2;
    float distance=pending>=0.0 ? pending : traceInterior(p,direction);
    pending=-1.0;
    vec3 point;int species;
    // Each iteration makes at most one next-event connection after choosing its
    // continuation. A single call site keeps one inlined visibility test.
    bool connect=false,alive=true,roulette=true,weighted=true;
    vec4 connectWeight=beta,connectAlbedo=vec4(1.0),connectDensity=ru;
    vec3 connectPoint=p,connectNormal=vec3(0),connectOutgoing=vec3(0);
    int connectSpecies=-1;
    if (forced) {
      // The collision is sampled ∝ majorant transmittance on the segment; ratio
      // tracking estimates the real transmittance. The next iteration repeats
      // this segment with the analog collision or surface hit.
      forced=false;pending=distance;roulette=false;
      float survival=exp(-uAirMajorant*distance);
      float t=-log(max(1e-12,1.0-randomValue()*(1.0-survival)))/uAirMajorant;
      vec3 q=p+direction*t;
      float density=airDensity(q);
      vec4 molecular=sigmaRayleigh*density,aerosol=aerosolScattering*density;
      float scattering=dot(molecular+aerosol,vec4(1.0));
      if (scattering>0.0) {
        // One scatterer for all wavelengths, chosen by its mean share.
        float molecularChance=dot(molecular,vec4(1.0))/scattering;
        bool rayleigh=randomValue()<molecularChance;
        connect=true;weighted=false;connectPoint=q;connectOutgoing=direction;
        connectSpecies=rayleigh ? 0 : 1;
        vec4 sigma=rayleigh ? molecular/molecularChance : aerosol/(1.0-molecularChance);
        connectWeight=beta*sigma*(1.0-survival)/(uAirMajorant*exp(-uAirMajorant*t))*shadowTransmission(p,direction,t);
      }
    } else if (mediumEvent(p,direction,distance,beta,ru,rl,point,species)) {
      cloudPath=cloudPath || species==2;
      normalizePath(beta,ru);
      // Only the camera segment itself; segments after a pane reflection are not
      // covered by the forced estimate.
      singleAir=cameraSegment && species<2;cameraSegment=false;
      connect=!singleAir;connectWeight=beta;connectDensity=ru;connectPoint=point;connectOutgoing=direction;connectSpecies=species;
      haze=haze || order==0;
      vec3 next=phaseSample(direction,species);
      vec4 phase,pdf;
      scatteringPhase(dot(direction,next),species,phase,pdf);
      lastPdf=max(pdf.x,1e-10);
      rl=ru/lastPdf;
      beta*=phase/lastPdf;ru*=pdf/lastPdf;
      direction=next;p=point;lastVertex=point;neeReachable=true;order++;
    } else {
      if (maxComponent(beta)<=0.0) break;
      cameraSegment=false;
      vec3 hit=p+direction*distance;
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
        glassPlate(dot(normal,direction),reflectance,transmittance);
        const float REFLECTION_CHANCE=0.85;
        if (randomValue()<REFLECTION_CHANCE) {
          beta*=reflectance/REFLECTION_CHANCE;
          direction=reflect(direction,normal);p=hit+direction*(EPS*4.0);neeReachable=false;
        } else {
          beta*=transmittance/(1.0-REFLECTION_CHANCE);
          p=hit+direction*(EPS*4.0);inside=false;mirrorBounces=0;
        }
      } else {
        vec2 ground=groundCoordinates(hit);
        bool river=!cap && !windowAt(atan(hit.y,hit.x)) && riverEdge(ground)<0.0;
        normalizePath(beta,ru);
        connect=true;connectWeight=beta;connectDensity=ru;connectPoint=hit+normal*(EPS*4.0);
        p=connectPoint;lastVertex=connectPoint;singleAir=false;order++;
        if (river) {
          vec3 outgoing=-direction;
          connectNormal=normal;connectOutgoing=outgoing;connectSpecies=-2;
          vec3 next=waterSample(normal,outgoing);
          vec2 water=waterReflection(normal,outgoing,next);
          alive=water.y>0.0;roulette=false;
          lastPdf=max(water.y,1e-10);
          beta*=water.x/lastPdf;rl=ru/lastPdf;
          direction=next;neeReachable=true;
        } else {
          vec4 albedo=materialSpectrum(materialAlbedo(hit,normal,kind,id));
          vec3 shading=cap ? normal : shadingNormal(hit,normal,kind,id);
          // Emission is a source term; it does not brighten unlit fields or endcaps.
          if (!cap && !windowAt(atan(hit.y,hit.x)) && uSolarPower<0.02) radiance+=beta*settlementLamp(ground)*lampRadiance()/average(ru);
          connectNormal=shading;connectAlbedo=albedo;
          beta*=albedo;
          direction=around(shading,sqrt(randomValue()),2.0*PI*randomValue());
          // Shading-normal samples beneath the geometric surface are absorbed.
          alive=dot(direction,normal)>0.0;
          lastPdf=max(0.0,dot(shading,direction))/PI;rl=ru/max(lastPdf,1e-10);neeReachable=true;
        }
      }
    }
    if (connect) {
      vec4 light=connectWeight*directLight(connectPoint,connectNormal,connectOutgoing,connectSpecies,connectAlbedo,weighted,connectDensity);
      if (weighted) radiance+=light;
      else scattered+=light;
    }
    if (!alive) break;
    // Direct lighting is already estimated above. Terminate weak continuation
    // paths from the first event; surviving paths retain their expected energy.
    if (order>=1 && roulette) {
      // A compulsory 5% loss per collision makes the hundreds of conservative
      // droplet scatterings in fog exponentially rare, extremely bright paths.
      // Still terminate weak paths, but let unit-throughput cloud paths live.
      float survival=min(cloudPath ? 1.0 : 0.95,maxComponent(beta)/average(ru));
      if (randomValue()>=survival) break;
      beta/=survival;
    }
  }
  hazeRadiance=scattered+(haze ? radiance : vec4(0.0));
  return radiance+scattered;
}
