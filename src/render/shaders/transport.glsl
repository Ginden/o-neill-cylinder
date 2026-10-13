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
float extinctionAt(vec3 p) {
  if (!uAtmosphere || uPressure<=0.0) return 0.0;
  return (rayleighCoefficient()+uAerosol*uAerosolScale*particleRow(0,1).b)*airDensity(p)+weatherAt(p).r*particleRow(0,2).b;
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
    float molecular=rayleighCoefficient()*density;
    float aerosol=uAerosol*density*uAerosolScale*particleRow(0,1).a;
    float cloud=weatherAt(q).r*particleRow(0,2).a;
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

// Next-event estimation samples the finite Sun and tests the entire aperture →
// mirror → Sun connection. No ray may receive a beam just because of its sector.
float directLight(vec3 p,vec3 normal,vec3 outgoing,int species,float albedo) {
  vec3 sun=solarSample();
  int source=int(randomValue()*float(uMirrorCount+1));
  vec3 direction=source==0 ? sun : reflect(sun,uMirrorNormal[source-1]);
  float samplingPdf=species<0 ? max(0.0,dot(normal,direction))/PI : phasePdf(dot(outgoing,direction),species);
  float phase=species<0 ? samplingPdf : phasePhysical(dot(outgoing,direction),species);
  if (phase<=0.0) return 0.0;
  float distance=traceInterior(p,direction);
  vec3 opening=p+direction*distance;
  if (!windowOpening(opening)) return 0.0;
  // Check that this is the wall, rather than a terrain point with the same angle.
  if (abs(length(opening.xy)-uRadius)>0.001) return 0.0;
  float transmission=glassPlate(dot(normalize(opening.xy),direction.xy)).y;
  vec3 outsidePoint=opening+direction*(EPS*4.0),externalDirection=direction;
  float externalWeight=exteriorPath(outsidePoint,externalDirection);
  if (externalWeight==0.0 || dot(externalDirection,sun)<0.9999999) return 0.0;
  float lightPdf=1.0/(float(uMirrorCount+1)*SUN_SOLID_ANGLE);
  float mis=powerWeight(lightPdf,samplingPdf);
  return albedo*phase*float(uMirrorCount+1)*solarIrradiance()*transmission*externalWeight*mis*shadowTransmission(p,direction,distance);
}

float pathRadiance(vec3 p,vec3 direction) {
  float weight=1.0,radiance=0.0;
  float lastPdf=0.0;
  bool neeReachable=true;
  bool inside=true;
  int mirrorBounces=0;
  for (int depth=0;depth<64;depth++) {
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
        float lightPdf=1.0/(float(uMirrorCount+1)*SUN_SOLID_ANGLE);
        float mis=lastPdf==0.0 || !neeReachable || mirrorBounces>1 ? 1.0 : powerWeight(lastPdf,lightPdf);
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
    float distance=traceInterior(p,direction);
    vec3 point;int species;
    if (mediumEvent(p,direction,distance,weight,point,species)) {
      radiance+=weight*directLight(point,vec3(0),direction,species,1.0);
      vec3 next=phaseSample(direction,species);
      lastPdf=phasePdf(dot(direction,next),species);
      weight*=phasePhysical(dot(direction,next),species)/max(lastPdf,1e-10);
      direction=next;p=point;neeReachable=true;
    } else {
      if (weight<=0.0) break;
      vec3 hit=p+direction*distance;
      vec3 normal=interiorNormal(hit);
      if (windowOpening(hit) && abs(length(hit.xy)-uRadius)<0.001) {
        vec2 glass=glassPlate(dot(normal,direction));
        if (randomValue()<glass.x) {
          direction=reflect(direction,normal);p=hit+direction*(EPS*4.0);neeReachable=false;
        } else {
          weight*=glass.y/max(1.0-glass.x,1e-8);
          p=hit+direction*(EPS*4.0);inside=false;mirrorBounces=0;
        }
      } else {
        bool cap=abs(hit.z)>=uLength*0.5-0.001;
        bool river=!cap && !windowAt(atan(hit.y,hit.x)) && riverDistance(groundCoordinates(hit))<0.035;
        if (river) {
          // Deep, absorbing water: the transmitted branch is absorbed below the
          // surface. The reflected branch follows unpolarized Fresnel optics.
          float c=abs(dot(normal,direction)),eta=1.333;
          float ct=sqrt(1.0-(1.0-c*c)/(eta*eta));
          float rs=(c-eta*ct)/(c+eta*ct),rp=(eta*c-ct)/(eta*c+ct);
          weight*=0.5*(rs*rs+rp*rp);
          direction=reflect(direction,normal);p=hit+direction*(EPS*4.0);neeReachable=false;
          continue;
        }
        float albedo=materialSpectrum(surfaceAlbedo(hit,normal));
        // Emission is a source term; it does not brighten unlit fields or endcaps.
        if (abs(hit.z)<uLength*0.5-0.001 && !windowAt(atan(hit.y,hit.x)) && uSolarPower<0.02) {
          vec2 uv=groundCoordinates(hit);
          float city=step(0.66,noise(uv*1.4+113.0))*(1.0-smoothstep(0.18,0.45,riverDistance(uv)));
          float lamp=step(0.94,hash(floor(uv*80.0)));
          radiance+=weight*city*lamp*lampRadiance();
        }
        p=hit+normal*(EPS*4.0);
        radiance+=weight*directLight(p,normal,vec3(0),-1,albedo);
        weight*=albedo;
        direction=around(normal,sqrt(randomValue()),2.0*PI*randomValue());
        lastPdf=max(0.0,dot(normal,direction))/PI;neeReachable=true;
      }
    }
    if (depth>=3) {
      float survival=min(0.95,weight);
      if (randomValue()>=survival) break;
      weight/=survival;
    }
  }
  return radiance;
}
