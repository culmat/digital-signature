-- Rewrite GitHub Wiki-style links (bare page names) to .html slugs.
-- External links (http/https/mailto) and anchors (#) are left unchanged.
-- "Home" is mapped to "index" so it resolves to index.html at the root.

local function wiki_to_slug(name)
  if name == "Home" then return "index" end
  return name:lower()
end

function Link(el)
  local url = el.target
  if url:match("^https?://") or url:match("^mailto:") or url:match("^#") then
    return el
  end
  -- Strip any accidental .md extension from wiki links
  url = url:gsub("%.md$", "")
  el.target = wiki_to_slug(url) .. ".html"
  return el
end
