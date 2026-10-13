uniform float uExposure;
uniform bool uAdaptive;
uniform mat3 uWhiteBalance;
// AgX (Sobotka; Blender and Filament constants): a film-like log encoding and
// sigmoid in a Rec. 2020 working space. Highlights desaturate toward white as
// film and sensors do, neutrals stay neutral and zero radiance stays black.
vec3 agxContrast(vec3 x) {
  vec3 x2=x*x,x4=x2*x2;
  return 15.5*x4*x2-40.14*x4*x+31.96*x4-6.868*x2*x+0.4298*x2+0.1191*x-0.00232;
}
vec3 displayColor(vec3 xyz) {
  if(uAdaptive) xyz=uWhiteBalance*xyz;
  vec3 rec2020=mat3(1.7166512,-0.6666844,0.0176399,-0.3556708,1.6164812,-0.0427706,-0.2533663,0.0157685,0.9421031)*xyz;
  float luminance=max(xyz.y,0.0);
  if(uAdaptive) {
    // Approximate loss of color at low luminance. No blue tint or invented light.
    float photopic=smoothstep(-2.3,0.7,log(max(luminance*uReferenceIlluminance,1e-8))/log(10.0));
    rec2020=mix(vec3(luminance),rec2020,photopic);
  }
  const mat3 inset=mat3(vec3(0.856627153315983,0.137318972929847,0.11189821299995),
    vec3(0.0951212405381588,0.761241990602591,0.0767994186031903),vec3(0.0482516061458583,0.101439036467562,0.811302368396859));
  const mat3 outset=mat3(vec3(1.1271005818144368,-0.1413297634984383,-0.14132976349843826),
    vec3(-0.11060664309660323,1.157823702216272,-0.11060664309660294),vec3(-0.016493938717834573,-0.016493938717834257,1.2519364065950405));
  const float minimumEv=-12.47393,maximumEv=4.026069;
  vec3 encoded=clamp((log2(max(inset*(max(rec2020,0.0)*uExposure),1e-10))-minimumEv)/(maximumEv-minimumEv),0.0,1.0);
  // A mild contrast and saturation look on the encoded image (cf. Blender's
  // "Punchy"); neutrals are unchanged.
  vec3 look=pow(max(agxContrast(encoded),0.0),vec3(1.12));
  float luma=dot(look,vec3(0.2126,0.7152,0.0722));
  look=luma+1.15*(look-luma);
  vec3 film=pow(max(outset*look,0.0),vec3(2.2));
  return clamp(mat3(1.6605,-0.1246,-0.0182,-0.5876,1.1329,-0.1006,-0.0728,-0.0083,1.1187)*film,0.0,1.0);
}
vec3 encodeSRGB(vec3 color) {
  return mix(color*12.92,1.055*pow(max(color,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),color));
}
