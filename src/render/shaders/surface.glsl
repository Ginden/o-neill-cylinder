vec3 groundAlbedo(vec3 p, vec3 n) {
  vec2 uv = groundCoordinates(p);
  float river = 1.0 - smoothstep(0.035, 0.06, riverDistance(uv));
  // Staggered, gently warped parcels follow the landscape instead of making
  // a uniform checkerboard. Coordinates and feature sizes are in kilometres.
  vec2 warp=vec2(noise(uv*0.7+13.0),noise(uv*0.7+47.0))-0.5;
  vec2 plots=(uv+warp*0.18)*vec2(3.8,2.7);
  plots.x+=hash(vec2(floor(plots.y),19.0))*0.85;
  vec2 parcel=floor(plots);
  float plot=hash(parcel);
  vec3 pasture=mix(vec3(0.075,0.19,0.045),vec3(0.19,0.29,0.085),plot);
  vec3 crop=mix(vec3(0.25,0.26,0.09),vec3(0.43,0.36,0.16),hash(parcel+23.0));
  vec3 field=mix(pasture,crop,smoothstep(0.48,0.82,plot));
  float textureVariation=0.88+0.24*noise(uv*65.0)+0.1*(noise(uv*180.0)-0.5);
  field*=textureVariation;
  // Thin planted boundaries, interrupted by access tracks.
  vec2 edge=min(fract(plots),1.0-fract(plots))/vec2(3.8,2.7);
  float boundary=1.0-smoothstep(0.0015,0.005,min(edge.x,edge.y));
  field=mix(field,vec3(0.055,0.12,0.033),boundary*0.65);
  float ridge=fbm(uv*1.8+70.0);
  float forests=smoothstep(0.46,0.64,ridge);
  float canopy=0.7+0.5*noise(uv*95.0);
  field=mix(field,vec3(0.045,0.12,0.033)*canopy,forests);
  // Riparian vegetation and an irregular gravel margin break the hard water edge.
  float bank=riverDistance(uv);
  field=mix(field,vec3(0.065,0.16,0.06),1.0-smoothstep(0.06,0.1,bank));
  float shore=(1.0-smoothstep(0.043,0.052,bank+0.002*noise(uv*150.0)));
  field=mix(field,vec3(0.20,0.19,0.14),shore);
  // Small settlements along the river; roofs, roads and planted field boundaries.
  float village = step(0.66, noise(uv * 1.4 + 113.0)) * (1.0-smoothstep(0.18, 0.45, riverDistance(uv)));
  vec2 blocks = fract(uv * 55.0);
  float roof = step(0.2, blocks.x) * step(blocks.x, 0.75) * step(0.2, blocks.y) * step(blocks.y, 0.75);
  float occupied=step(0.38,hash(floor(uv*55.0)+217.0));
  vec3 roofColor=mix(vec3(0.18,0.20,0.19),vec3(0.32,0.17,0.10),hash(floor(uv*55.0)+51.0));
  field=mix(field,roofColor,village*roof*occupied);
  vec3 water = vec3(0.025, 0.055, 0.045);
  float radialSlope = 1.0 - abs(dot(n.xy, normalize(p.xy)));
  field = mix(field, vec3(0.25, 0.23, 0.19), smoothstep(0.08, 0.3, radialSlope));
  return mix(field, water, river);
}

vec3 surfaceNormal(vec3 p) {
  float e = 0.002;
  return normalize(vec3(
    surfaceDistance(p + vec3(e,0,0)) - surfaceDistance(p - vec3(e,0,0)),
    surfaceDistance(p + vec3(0,e,0)) - surfaceDistance(p - vec3(0,e,0)),
    surfaceDistance(p + vec3(0,0,e)) - surfaceDistance(p - vec3(0,0,e))));
}
