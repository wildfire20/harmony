import React, { useEffect, useRef } from 'react';

const MathRenderer = ({ math, inline = false, className = '' }) => {
  const mathRef = useRef();

  useEffect(() => {
    if (mathRef.current && window.MathJax) {
      // Clear any existing MathJax content
      mathRef.current.innerHTML = math;
      
      // Tell MathJax to process this element
      window.MathJax.typesetPromise([mathRef.current]).catch((err) => {
        console.log('MathJax typeset error:', err);
      });
    }
  }, [math]);

  useEffect(() => {
    // Load MathJax if not already loaded
    if (!window.MathJax) {
      const script = document.createElement('script');
      script.src = 'https://polyfill.io/v3/polyfill.min.js?features=es6';
      script.onload = () => {
        const mathJaxScript = document.createElement('script');
        mathJaxScript.id = 'MathJax-script';
        mathJaxScript.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js';
        mathJaxScript.onload = () => {
          window.MathJax = {
            tex: {
              inlineMath: [['$', '$'], ['\\(', '\\)']],
              displayMath: [['$$', '$$'], ['\\[', '\\]']],
              processEscapes: true,
              processEnvironments: true
            },
            options: {
              skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre'],
              ignoreHtmlClass: 'tex2jax_ignore',
              processHtmlClass: 'tex2jax_process'
            }
          };
          
          // Reprocess current element after MathJax loads
          if (mathRef.current) {
            mathRef.current.innerHTML = math;
            window.MathJax.typesetPromise([mathRef.current]);
          }
        };
        document.head.appendChild(mathJaxScript);
      };
      document.head.appendChild(script);
    }
  }, []);

  // Check if the content contains math expressions
  const containsMath = math && (
    math.includes('$') || 
    math.includes('\\(') || 
    math.includes('\\[') || 
    math.includes('\\begin{') ||
    /\\[a-zA-Z]+/.test(math) // LaTeX commands
  );

  if (!containsMath) {
    // Regular text, no math processing needed
    return <span className={className}>{math}</span>;
  }

  return (
    <span 
      ref={mathRef}
      className={`math-content ${className}`}
      style={inline ? { display: 'inline' } : { display: 'block' }}
    >
      {math}
    </span>
  );
};

export default MathRenderer;
