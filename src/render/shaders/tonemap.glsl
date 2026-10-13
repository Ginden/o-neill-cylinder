uniform float uExposure;
uniform bool uAdaptive;
uniform mat3 uWhiteBalance;
// A luminance curve preserves chromaticity through the midtones, unlike applying
// independent S-curves to R, G and B. Gamut compression approaches display white.
vec3 displayColor(vec3 xyz) {
  if(uAdaptive) xyz=uWhiteBalance*xyz;
  vec3 rgb=vec3(dot(vec3(3.2406,-1.5372,-0.4986),xyz),
    dot(vec3(-0.9689,1.8758,0.0415),xyz),dot(vec3(0.0557,-0.2040,1.0570),xyz));
  float luminance=max(xyz.y,0.0);
  if(uAdaptive) {
    // Approximate loss of color at low luminance. No blue tint or invented light.
    float photopic=smoothstep(-2.3,0.7,log(max(luminance*uReferenceIlluminance,1e-8))/log(10.0));
    rgb=mix(vec3(luminance),rgb,photopic);
  }
  float exposed=luminance*uExposure;
  float mapped=clamp((exposed*(2.51*exposed+0.03))/(exposed*(2.43*exposed+0.59)+0.14),0.0,1.0);
  rgb=max(rgb,vec3(0.0))*mapped/max(luminance,1e-10);
  float peak=max(rgb.r,max(rgb.g,rgb.b));
  if(peak>1.0) rgb=mix(vec3(mapped),rgb,(1.0-mapped)/max(peak-mapped,1e-8));
  return clamp(rgb,0.0,1.0);
}
vec3 encodeSRGB(vec3 color) {
  return mix(color*12.92,1.055*pow(max(color,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),color));
}
