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

vec4 particleRow(int column,int species) {
  int row=min(39,int(spectralBin));
  vec4 a=species==1 ? texelFetch(uAerosolPhase,ivec2(column,row),0) : texelFetch(uCloudPhase,ivec2(column,row),0);
  vec4 b=species==1 ? texelFetch(uAerosolPhase,ivec2(column,row+1),0) : texelFetch(uCloudPhase,ivec2(column,row+1),0);
  return mix(a,b,spectralBin-float(row));
}
vec4 particleTable(float u,int species) {
  float index=clamp(u,0.0,1.0)*1023.0;
  int lo=min(1022,int(index));
  return mix(particleRow(lo,species),particleRow(lo+1,species),index-float(lo));
}
float rayleighCoefficient() {
  float sigma2=1.0/pow(wavelength*0.001,2.0);
  float n=1.0+1e-8*(8342.13+2406030.0/(130.0-sigma2)+15997.0/(38.9-sigma2));
  float nRef=1.000277824; // Edlén dry-air dispersion at 550 nm.
  float factor=(n*n-1.0)/(n*n+2.0)/((nRef*nRef-1.0)/(nRef*nRef+2.0));
  return 0.013558*pow(550.0/wavelength,4.0)*factor*factor;
}
void prepareWavelength() {
  sigmaRayleigh=rayleighCoefficient();
  sigmaAerosol=particleRow(0,1).ba*uAerosol*uAerosolScale;
  sigmaCloud=particleRow(0,2).ba;
  glassIndex=glassIndexAtWavelength();
  solarSpectrum=blackbody(5772.0)*uSolarPower;lampSpectrum=blackbody(2800.0)*uLampScale;
}
float extinctionAt(vec3 p) {
  if (!uAtmosphere || uPressure<=0.0) return 0.0;
  return (sigmaRayleigh+sigmaAerosol.x)*airDensity(p)+weatherAt(p).r*sigmaCloud.x;
}
float phasePhysical(float cosine,int species) {
  if (species==0) return 3.0/(16.0*PI)*(1.0+cosine*cosine);
  return particleTable(sqrt(acos(clamp(cosine,-1.0,1.0))/PI),species).r;
}
float phasePdf(float cosine,int species) {
  if (species==0) return phasePhysical(cosine,species);
  float theta=acos(clamp(cosine,-1.0,1.0));
  float u=max(1e-6,sqrt(theta/PI));
  int lo=min(1022,int(u*1023.0));
  float a=particleRow(lo,species).g,b=particleRow(lo+1,species).g;
  return (b-a)*1023.0/(4.0*PI*PI*u*max(sin(theta),1e-8));
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
      if (particleRow(mid,species).g<target) lo=mid;else hi=mid;
    }
    float a=particleRow(lo,species).g,b=particleRow(hi,species).g;
    float u=(float(lo)+(target-a)/max(b-a,1e-8))/1023.0;
    cosine=cos(PI*u*u);
  }
  return around(axis,clamp(cosine,-1.0,1.0),2.0*PI*randomValue());
}

// Per-cell majorants bound all eight trilinearly interpolated cloud samples.
// Air's global bound is small; a global cloud bound would stall dense scenes.
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

float shadowTransmission(vec3 p,vec3 d,float distance) {
  if (!uAtmosphere) return 1.0;
  float weight=1.0;
  float t=0.0;
  for (int i=0;i<2048;i++) {
    if (t>=distance) return weight;
    float cellDistance;
    float majorant=cellMajorant(p+d*(t+EPS),d,cellDistance);
    float flight=majorant>0.0 ? -log(max(1e-7,1.0-randomValue()))/majorant : 1e20;
    float remaining=min(cellDistance,distance-t);
    if (flight>=remaining) { t+=remaining+EPS;continue; }
    t+=flight;
    weight*=max(0.0,1.0-extinctionAt(p+d*t)/majorant);
    if (weight<1e-7) return 0.0;
  }
  return 0.0;
}

// Analog delta tracking at the sampled wavelength. Null events leave throughput
// unchanged; real collisions select the physical molecular/particle cross-section.
bool mediumEvent(vec3 p,vec3 d,float distance,inout float weight,out vec3 point,out int species) {
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
    float density=airDensity(q);
    float molecular=sigmaRayleigh*density;
    float aerosol=sigmaAerosol.y*density;
    float cloud=weatherAt(q).r*sigmaCloud.y;
    float total=extinctionAt(q);
    float choice=randomValue()*majorant;
    if (choice>=total) continue;
    if (choice<molecular) species=0;
    else if (choice<molecular+aerosol) species=1;
    else if (choice<molecular+aerosol+cloud) species=2;
    else {weight=0.0;return false;}
    point=q;
    return true;
  }
  weight=0.0;return false;
}

float powerWeight(float a,float b) {return a*a/(a*a+b*b);}

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
// the entire aperture → mirror → Sun connection. `weighted` applies multiple
// importance sampling against BSDF or phase sampling; the forced camera-segment
// estimate has no such partner.
float directLight(vec3 p,vec3 normal,vec3 outgoing,int species,float albedo,bool weighted) {
  vec3 sun=solarSample();
  int count;
  vec4 routes=openRoutes(p,sun,count);
  if (count==0) return 0.0;
  int pick=min(count-1,int(randomValue()*float(count))),source=0;
  for (int i=0;i<4;i++) {
    if (routes[i]>0.0) {
      if (pick==0) {source=i;break;}
      pick--;
    }
  }
  vec3 direction=routeDirection(source,sun);
  float samplingPdf=species<0 ? max(0.0,dot(normal,direction))/PI : phasePdf(dot(outgoing,direction),species);
  float phase=species<0 ? samplingPdf : phasePhysical(dot(outgoing,direction),species);
  if(species==-2) {
    vec2 water=waterReflection(normal,outgoing,direction);
    phase=water.x;samplingPdf=water.y;
  }
  if (phase<=0.0) return 0.0;
  float distance=traceInterior(p,direction);
  vec3 opening=p+direction*distance;
  // The hull test passed; this rejects terrain, trees or roofs in the way.
  if (!windowOpening(opening) || abs(length(opening.xy)-uRadius)>0.001) return 0.0;
  float transmission=glassPlate(dot(normalize(opening.xy),direction.xy)).y;
  float lightPdf=1.0/(float(count)*SUN_SOLID_ANGLE);
  float mis=weighted ? powerWeight(lightPdf,samplingPdf) : 1.0;
  return albedo*phase*float(count)*solarIrradiance()*transmission*routes[source]*mis*shadowTransmission(p,direction,distance);
}

// Returns total radiance and the haze part: single scattering of air on the
// camera segment plus paths whose first event is a medium collision there. The
// display filter treats it separately from light reflected by visible surfaces.
vec2 pathRadiance(vec3 p,vec3 direction) {
  float weight=1.0,radiance=0.0,scattered=0.0;
  bool haze=false;
  float lastPdf=0.0;
  vec3 lastVertex=p;
  bool neeReachable=true;
  bool inside=true;
  int mirrorBounces=0,order=0;
  // Every camera ray estimates single scattering by air with one forced
  // collision on its segment; analog air collisions there omit that term
  // (no next-event estimate, no direct solar hit) to avoid counting it twice.
  bool forced=uAtmosphere && uPressure>0.0 && uAirMajorant>0.0,singleAir=false,cameraSegment=true;
  float pending=-1.0;
  for (int iteration=0;iteration<65;iteration++) {
    if (!inside) {
      float closest=shellHit(p,direction);
      int panel=-1;
      for (int i=0;i<3;i++) {
        if (i>=uMirrorCount) break;
        float t=mirrorHit(p,direction,i);
        if (t<closest) {closest=t;panel=i;}
      }
      if (closest>1e19) {
        float solar=dot(direction,uSun)>=cos(SOLAR_RADIUS) ? solarRadiance() : 0.0;
        float mis=1.0;
        if (solar>0.0 && lastPdf>0.0 && neeReachable && mirrorBounces<=1) {
          // Next-event estimation chose among the routes open at the last vertex.
          int count;
          openRoutes(lastVertex,direction,count);
          mis=singleAir ? 0.0 : powerWeight(lastPdf,1.0/(float(max(count,1))*SUN_SOLID_ANGLE));
        }
        radiance+=weight*solar*mis;
        break;
      }
      vec3 hit=p+direction*closest;
      if (panel>=0) {
        if (dot(direction,uMirrorNormal[panel])<=0.0) break; // Black rear coating.
        direction=reflect(direction,uMirrorNormal[panel]);
        weight*=uMirrorReflectivity;mirrorBounces++;
        p=hit+direction*(EPS*4.0);continue;
      }
      if (!windowOpening(hit)) break; // Black exterior hull.
      vec3 normal=normalize(vec3(hit.xy,0));
      vec2 glass=glassPlate(dot(normal,direction));
      if (randomValue()<glass.x) {direction=reflect(direction,normal);neeReachable=false;}
      else {weight*=glass.y/max(1.0-glass.x,1e-8);inside=true;neeReachable=false;}
      p=hit+direction*(EPS*4.0);continue;
    }
    landObjects=order<2;
    float distance=pending>=0.0 ? pending : traceInterior(p,direction);
    pending=-1.0;
    vec3 point;int species;
    // Each iteration makes at most one next-event connection after choosing its
    // continuation. A single call site keeps one inlined visibility test.
    bool connect=false,alive=true,roulette=true,weighted=true;
    float connectWeight=weight,connectAlbedo=1.0;
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
      float molecular=sigmaRayleigh*density,scattering=molecular+sigmaAerosol.y*density;
      if (scattering>0.0) {
        connect=true;weighted=false;connectPoint=q;connectOutgoing=direction;
        connectSpecies=randomValue()*scattering<molecular ? 0 : 1;
        connectWeight=weight*scattering*(1.0-survival)/(uAirMajorant*exp(-uAirMajorant*t))*shadowTransmission(p,direction,t);
      }
    } else if (mediumEvent(p,direction,distance,weight,point,species)) {
      // Only the camera segment itself; segments after a pane reflection are not
      // covered by the forced estimate.
      singleAir=cameraSegment && species<2;cameraSegment=false;
      connect=!singleAir;connectWeight=weight;connectPoint=point;connectOutgoing=direction;connectSpecies=species;
      haze=haze || order==0;
      vec3 next=phaseSample(direction,species);
      lastPdf=phasePdf(dot(direction,next),species);
      weight*=phasePhysical(dot(direction,next),species)/max(lastPdf,1e-10);
      direction=next;p=point;lastVertex=point;neeReachable=true;order++;
    } else {
      if (weight<=0.0) break;
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
        vec2 glass=glassPlate(dot(normal,direction));
        const float REFLECTION_CHANCE=0.85;
        if (randomValue()<REFLECTION_CHANCE) {
          weight*=glass.x/REFLECTION_CHANCE;
          direction=reflect(direction,normal);p=hit+direction*(EPS*4.0);neeReachable=false;
        } else {
          weight*=glass.y/(1.0-REFLECTION_CHANCE);
          p=hit+direction*(EPS*4.0);inside=false;mirrorBounces=0;
        }
      } else {
        vec2 ground=groundCoordinates(hit);
        bool river=!cap && !windowAt(atan(hit.y,hit.x)) && riverEdge(ground)<0.0;
        connect=true;connectWeight=weight;connectPoint=hit+normal*(EPS*4.0);
        p=connectPoint;lastVertex=connectPoint;singleAir=false;order++;
        if (river) {
          vec3 outgoing=-direction;
          connectNormal=normal;connectOutgoing=outgoing;connectSpecies=-2;
          vec3 next=waterSample(normal,outgoing);
          vec2 water=waterReflection(normal,outgoing,next);
          alive=water.y>0.0;roulette=false;
          weight*=water.x/max(water.y,1e-10);
          direction=next;lastPdf=water.y;neeReachable=true;
        } else {
          float albedo=materialSpectrum(materialAlbedo(hit,normal,kind,id));
          vec3 shading=cap ? normal : shadingNormal(hit,normal,kind,id);
          // Emission is a source term; it does not brighten unlit fields or endcaps.
          if (!cap && !windowAt(atan(hit.y,hit.x)) && uSolarPower<0.02) radiance+=weight*settlementLamp(ground)*lampRadiance();
          connectNormal=shading;connectAlbedo=albedo;
          weight*=albedo;
          direction=around(shading,sqrt(randomValue()),2.0*PI*randomValue());
          // Shading-normal samples beneath the geometric surface are absorbed.
          alive=dot(direction,normal)>0.0;
          lastPdf=max(0.0,dot(shading,direction))/PI;neeReachable=true;
        }
      }
    }
    if (connect) {
      float light=connectWeight*directLight(connectPoint,connectNormal,connectOutgoing,connectSpecies,connectAlbedo,weighted);
      if (weighted) radiance+=light;
      else scattered+=light;
    }
    if (!alive) break;
    if (order>=3 && roulette) {
      float survival=min(0.95,weight);
      if (randomValue()>=survival) break;
      weight/=survival;
    }
  }
  return vec2(radiance+scattered,scattered+(haze ? radiance : 0.0));
}
