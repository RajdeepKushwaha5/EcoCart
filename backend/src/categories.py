"""Device categories EcoCart covers."""

# "electronics" covers any other electronic device: speakers, cameras, consoles, printers and so on.
CATEGORIES = {"phone", "laptop", "tablet", "watch", "earbuds", "tv", "appliance", "electronics"}


def device_category(product):
    """Catalog records written before categories existed are phones."""
    return product.get("category", "phone")


def in_category(products, category):
    if category is None:
        return list(products)
    return [product for product in products if device_category(product) == category]
